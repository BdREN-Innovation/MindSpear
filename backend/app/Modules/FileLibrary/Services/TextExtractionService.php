<?php

namespace App\Modules\FileLibrary\Services;

use DOMDocument;
use DOMXPath;
use RuntimeException;
use XMLReader;
use ZipArchive;

/**
 * Pulls plain text out of DOCX, PPTX and TXT files, split into pages
 * (or slides, or sections) so the user can pick which parts to generate
 * questions from. PDFs are read in the browser with pdfjs instead.
 *
 * Only ZipArchive and the bundled XML extensions are used. Every zip entry
 * is size-checked before it is read, and external entities are never loaded.
 */
class TextExtractionService
{
    private const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

    private const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';

    private const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

    private const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

    private const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

    public static function supports(string $extension): bool
    {
        return in_array(strtolower($extension), ['docx', 'pptx', 'txt'], true);
    }

    /**
     * pages: the selectable parts. outline: headings (chapters) with the page
     * they start on, so a whole chapter can be picked at once.
     *
     * @return array{extractor: string, pages: list<array{index: int, label: string, text: string, word_count: int}>, outline: list<array{title: string, level: int, page: int}>}
     */
    public function extract(string $absolutePath, string $extension): array
    {
        $extension = strtolower($extension);
        $pages = match ($extension) {
            'docx' => $this->docx($absolutePath),
            'pptx' => $this->pptx($absolutePath),
            'txt' => $this->txt($absolutePath),
            default => throw new RuntimeException("No text extractor for .{$extension}"),
        };

        [$final, $outline] = $this->finalise($pages);

        return ['extractor' => $extension, 'pages' => $final, 'outline' => $outline];
    }

    // ── TXT ──────────────────────────────────────────────────────────────

    /** @return list<array{label: string, text: string}> */
    private function txt(string $path): array
    {
        $max = (int) config('file_library.max_text_chars', 500_000) * 4;
        $raw = (string) file_get_contents($path, false, null, 0, $max);
        $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw);
        if (! mb_check_encoding($raw, 'UTF-8')) {
            $raw = mb_convert_encoding($raw, 'UTF-8', 'Windows-1252');
        }
        $raw = str_replace(["\r\n", "\r"], "\n", $raw);

        $paragraphs = array_map(
            fn (string $p) => ['text' => trim($p), 'level' => null],
            preg_split("/\n\s*\n/u", $raw) ?: [],
        );

        return $this->sections($paragraphs);
    }

    // ── DOCX ─────────────────────────────────────────────────────────────

    /** @return list<array{label: string, text: string}> */
    private function docx(string $path): array
    {
        $xml = $this->readZipEntry($path, 'word/document.xml');

        $reader = new XMLReader;
        if (! $reader->XML($xml, 'UTF-8', LIBXML_NONET | LIBXML_COMPACT | LIBXML_NOWARNING | LIBXML_NOERROR)) {
            throw new RuntimeException('The document could not be read.');
        }

        $pages = [[]];          // explicit page breaks → list of paragraph lists
        $paragraph = '';
        $level = null;          // heading level of the current paragraph (1 = top)
        $rowCells = null;       // inside a table row: list of cell texts
        $cell = '';
        $tableDepth = 0;

        $flushParagraph = function () use (&$pages, &$paragraph, &$level, &$rowCells, &$cell) {
            $text = trim(preg_replace('/[ \t]+/u', ' ', $paragraph));
            if ($rowCells !== null) {
                $cell = trim($cell . ' ' . $text);
            } elseif ($text !== '') {
                $pages[array_key_last($pages)][] = ['text' => $text, 'level' => $level];
            }
            $paragraph = '';
            $level = null;
        };
        $pageBreak = function () use (&$pages, $flushParagraph) {
            $flushParagraph();
            if ($pages[array_key_last($pages)] !== []) {
                $pages[] = [];
            }
        };

        while ($reader->read()) {
            if ($reader->namespaceURI !== self::NS_W) {
                continue;
            }
            $isStart = $reader->nodeType === XMLReader::ELEMENT;
            $isEnd = $reader->nodeType === XMLReader::END_ELEMENT;

            switch ($reader->localName) {
                case 't':
                    if ($isStart && ! $reader->isEmptyElement) {
                        $paragraph .= $reader->readString();
                    }
                    break;
                case 'tab':
                    if ($isStart) {
                        $paragraph .= ' ';
                    }
                    break;
                case 'br':
                    if ($isStart) {
                        if ($reader->getAttributeNs('type', self::NS_W) === 'page') {
                            $pageBreak();
                        } else {
                            $paragraph .= ' ';
                        }
                    }
                    break;
                case 'lastRenderedPageBreak':
                    if ($isStart && $tableDepth === 0) {
                        $pageBreak();
                    }
                    break;
                case 'pStyle':
                    if ($isStart && $tableDepth === 0) {
                        $style = strtolower((string) $reader->getAttributeNs('val', self::NS_W));
                        if (preg_match('/^heading\s*([1-9])$/', $style, $m)) {
                            $level = (int) $m[1];
                        } elseif ($style === 'title') {
                            $level = 1;
                        }
                    }
                    break;
                case 'outlineLvl':
                    // Outline level set directly on the paragraph (0 = top, 9 = body text).
                    $value = (int) $reader->getAttributeNs('val', self::NS_W);
                    if ($isStart && $tableDepth === 0 && $level === null && $value < 9) {
                        $level = $value + 1;
                    }
                    break;
                case 'p':
                    if ($isEnd) {
                        $flushParagraph();
                    }
                    break;
                case 'tbl':
                    $tableDepth += $isStart ? 1 : ($isEnd ? -1 : 0);
                    break;
                case 'tr':
                    if ($isStart && $tableDepth === 1) {
                        $rowCells = [];
                    } elseif ($isEnd && $tableDepth === 1 && $rowCells !== null) {
                        $line = implode(' | ', array_filter($rowCells, fn ($c) => $c !== ''));
                        $rowCells = null;
                        if ($line !== '') {
                            $pages[array_key_last($pages)][] = ['text' => $line, 'level' => null];
                        }
                    }
                    break;
                case 'tc':
                    if ($isEnd && $tableDepth === 1 && $rowCells !== null) {
                        $rowCells[] = trim($cell);
                        $cell = '';
                    }
                    break;
            }
        }
        $reader->close();
        $flushParagraph();

        $pages = array_values(array_filter($pages, fn ($p) => $p !== []));

        // Real page breaks (saved by Word) give "Page n"; otherwise fall back to sections.
        if (count($pages) > 1) {
            return array_map(fn (array $paragraphs, int $i) => [
                'label' => 'Page ' . ($i + 1),
                'text' => implode("\n", array_column($paragraphs, 'text')),
                'headings' => $this->headingsOf($paragraphs),
            ], $pages, array_keys($pages));
        }

        return $this->sections($pages[0] ?? []);
    }

    // ── PPTX ─────────────────────────────────────────────────────────────

    /** @return list<array{label: string, text: string}> */
    private function pptx(string $path): array
    {
        $presentation = $this->dom($this->readZipEntry($path, 'ppt/presentation.xml'));
        $rels = $this->relationships($path, 'ppt/_rels/presentation.xml.rels', 'ppt');

        $xp = new DOMXPath($presentation);
        $xp->registerNamespace('p', self::NS_P);
        $slidePaths = [];
        foreach ($xp->query('//p:sldIdLst/p:sldId') as $node) {
            $rid = $node->getAttributeNS(self::NS_R, 'id');
            if (isset($rels[$rid])) {
                $slidePaths[] = $rels[$rid];
            }
        }

        $slides = [];
        foreach ($slidePaths as $i => $slidePath) {
            $slide = $this->dom($this->readZipEntry($path, $slidePath));
            $sx = new DOMXPath($slide);
            $sx->registerNamespace('p', self::NS_P);
            $sx->registerNamespace('a', self::NS_A);

            $title = '';
            foreach ($sx->query('//p:sp[p:nvSpPr/p:nvPr/p:ph[@type="title" or @type="ctrTitle"]]//a:p') as $p) {
                $title = trim($title . ' ' . $this->paragraphText($sx, $p));
            }

            $lines = [];
            foreach ($sx->query('//a:p') as $p) {
                $text = $this->paragraphText($sx, $p);
                if ($text !== '') {
                    $lines[] = $text;
                }
            }

            // Speaker notes often carry the actual explanation.
            $notes = [];
            $slideDir = dirname($slidePath);
            $slideRels = $this->relationships($path, $slideDir . '/_rels/' . basename($slidePath) . '.rels', $slideDir, 'notesSlide');
            foreach ($slideRels as $notesPath) {
                $nx = new DOMXPath($this->dom($this->readZipEntry($path, $notesPath)));
                $nx->registerNamespace('p', self::NS_P);
                $nx->registerNamespace('a', self::NS_A);
                foreach ($nx->query('//p:sp[p:nvSpPr/p:nvPr/p:ph[@type="body"]]//a:p') as $p) {
                    $text = $this->paragraphText($nx, $p);
                    if ($text !== '') {
                        $notes[] = $text;
                    }
                }
            }

            $text = implode("\n", $lines);
            if ($notes) {
                $text .= "\nNotes: " . implode(' ', $notes);
            }

            $slides[] = [
                'label' => 'Slide ' . ($i + 1) . ($title !== '' ? ': ' . mb_strimwidth($title, 0, 80, '…') : ''),
                'text' => $text,
            ];
        }

        return $slides;
    }

    private function paragraphText(DOMXPath $xp, \DOMNode $paragraph): string
    {
        $text = '';
        foreach ($xp->query('.//a:t', $paragraph) as $t) {
            $text .= $t->textContent;
        }

        return trim(preg_replace('/\s+/u', ' ', $text));
    }

    /**
     * Relationship id → zip path, resolved against $baseDir.
     *
     * @return array<string, string>
     */
    private function relationships(string $zipPath, string $relsPath, string $baseDir, ?string $typeSuffix = null): array
    {
        try {
            $doc = $this->dom($this->readZipEntry($zipPath, $relsPath));
        } catch (RuntimeException) {
            return [];
        }

        $map = [];
        foreach ($doc->getElementsByTagNameNS(self::NS_PKG_REL, 'Relationship') as $rel) {
            if ($typeSuffix && ! str_ends_with($rel->getAttribute('Type'), '/' . $typeSuffix)) {
                continue;
            }
            if ($rel->getAttribute('TargetMode') === 'External') {
                continue;
            }
            $map[$rel->getAttribute('Id')] = $this->resolvePath($baseDir, $rel->getAttribute('Target'));
        }

        return $map;
    }

    private function resolvePath(string $baseDir, string $target): string
    {
        $path = str_starts_with($target, '/') ? ltrim($target, '/') : $baseDir . '/' . $target;
        $parts = [];
        foreach (explode('/', $path) as $part) {
            if ($part === '..') {
                array_pop($parts);
            } elseif ($part !== '.' && $part !== '') {
                $parts[] = $part;
            }
        }

        return implode('/', $parts);
    }

    // ── Shared helpers ───────────────────────────────────────────────────

    private function readZipEntry(string $zipPath, string $entry): string
    {
        $zip = new ZipArchive;
        if ($zip->open($zipPath, ZipArchive::RDONLY) !== true) {
            throw new RuntimeException('The file is not a valid Office document.');
        }

        try {
            $stat = $zip->statName($entry);
            if ($stat === false) {
                throw new RuntimeException("Missing part {$entry}.");
            }
            if ($stat['size'] > (int) config('file_library.max_extract_bytes')) {
                throw new RuntimeException('The document is too large to read.');
            }
            $content = $zip->getFromName($entry);
            if ($content === false) {
                throw new RuntimeException("Unreadable part {$entry}.");
            }

            return $content;
        } finally {
            $zip->close();
        }
    }

    private function dom(string $xml): DOMDocument
    {
        $doc = new DOMDocument;
        $previous = libxml_use_internal_errors(true);
        $ok = $doc->loadXML($xml, LIBXML_NONET | LIBXML_COMPACT);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
        if (! $ok) {
            throw new RuntimeException('The document could not be read.');
        }

        return $doc;
    }

    /**
     * Groups paragraphs into sections: a new one starts at each heading or
     * once the current one reaches the configured number of words.
     *
     * @param  list<array{text: string, level: ?int}>  $paragraphs
     * @return list<array{label: string, text: string, headings: list<array{title: string, level: int}>}>
     */
    private function sections(array $paragraphs): array
    {
        $limit = max(100, (int) config('file_library.section_words', 600));
        $sections = [];
        $current = ['heading' => null, 'level' => null, 'lines' => [], 'words' => 0];

        $close = function () use (&$sections, &$current) {
            if ($current['lines']) {
                $sections[] = $current;
            }
            $current = ['heading' => null, 'level' => null, 'lines' => [], 'words' => 0];
        };

        foreach ($paragraphs as $paragraph) {
            if ($paragraph['text'] === '') {
                continue;
            }
            $words = $this->wordCount($paragraph['text']);
            $isHeading = $paragraph['level'] !== null;
            if ($isHeading || ($current['words'] > 0 && $current['words'] + $words > $limit)) {
                $close();
            }
            if ($isHeading && $current['heading'] === null) {
                $current['heading'] = mb_strimwidth($paragraph['text'], 0, 80, '…');
                $current['level'] = $paragraph['level'];
            }
            $current['lines'][] = $paragraph['text'];
            $current['words'] += $words;
        }
        $close();

        return array_map(fn (array $s, int $i) => [
            'label' => 'Section ' . ($i + 1) . ($s['heading'] ? ': ' . $s['heading'] : ''),
            'text' => implode("\n", $s['lines']),
            'headings' => $s['heading'] ? [['title' => $s['heading'], 'level' => $s['level']]] : [],
        ], $sections, array_keys($sections));
    }

    /**
     * @param  list<array{text: string, level: ?int}>  $paragraphs
     * @return list<array{title: string, level: int}>
     */
    private function headingsOf(array $paragraphs): array
    {
        $headings = [];
        foreach ($paragraphs as $paragraph) {
            if ($paragraph['level'] !== null) {
                $headings[] = ['title' => mb_strimwidth($paragraph['text'], 0, 150, '…'), 'level' => $paragraph['level']];
            }
        }

        return $headings;
    }

    /**
     * Drops empty pages, caps total text and adds index + word count. Headings
     * become the outline, pointing at the final page numbers (a heading on a
     * dropped page moves to the next kept page).
     *
     * @param  list<array{label: string, text: string, headings?: list<array{title: string, level: int}>}>  $pages
     * @return array{0: list<array{index: int, label: string, text: string, word_count: int}>, 1: list<array{title: string, level: int, page: int}>}
     */
    private function finalise(array $pages): array
    {
        $budget = (int) config('file_library.max_text_chars', 500_000);
        $out = [];
        $outline = [];
        $pending = [];      // headings waiting for the next kept page
        foreach ($pages as $page) {
            array_push($pending, ...($page['headings'] ?? []));
            $text = trim($page['text']);
            if ($text === '' || $budget <= 0) {
                continue;
            }
            if (mb_strlen($text) > $budget) {
                $text = mb_substr($text, 0, $budget);
            }
            $budget -= mb_strlen($text);
            $out[] = [
                'index' => count($out) + 1,
                'label' => $page['label'],
                'text' => $text,
                'word_count' => $this->wordCount($text),
            ];
            foreach ($pending as $heading) {
                if (count($outline) < 500) {
                    $outline[] = ['title' => $heading['title'], 'level' => $heading['level'], 'page' => count($out)];
                }
            }
            $pending = [];
        }

        return [$out, $outline];
    }

    /** Unicode-aware, so Bangla text counts correctly. */
    private function wordCount(string $text): int
    {
        return count(preg_split('/\s+/u', trim($text), -1, PREG_SPLIT_NO_EMPTY) ?: []);
    }
}
