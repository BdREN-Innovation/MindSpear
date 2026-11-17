<?php

namespace App\Deck\Slides\Types\Content;

use Illuminate\Validation\ValidationException;

/**
 * `paragraph`: rich text. The text itself lives in slides.body (run
 * body_snapshot); config only holds layout.
 *
 * slides.body reaches every participant unchanged, so the slide PATCH must
 * pass `body` through validateBody() (the contract has no body hook).
 *
 * Config: {align: 'left'|'center'|'right', text_size: 'small'|'medium'|'large'}.
 * Body: TipTap/ProseMirror JSON, see validateBody().
 * Answer payload: none (validateAnswer always throws). Aggregate: [].
 */
class ParagraphSlideType extends ContentSlideType
{
    public const ALIGNMENTS = ['left', 'center', 'right'];

    public const TEXT_SIZES = ['small', 'medium', 'large'];

    public const MAX_BODY_TEXT = 5000;

    public const MAX_BODY_NODES = 1000;

    public const MAX_BODY_DEPTH = 10;

    public const MAX_BODY_BYTES = 65536;

    public const MAX_HREF = 2048;

    private const BODY_BLOCKS = ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'codeBlock', 'horizontalRule'];

    /** Node type => node types it may contain (the StarterKit subset the editor uses). */
    private const BODY_CHILDREN = [
        'doc' => self::BODY_BLOCKS,
        'paragraph' => ['text', 'hardBreak'],
        'heading' => ['text', 'hardBreak'],
        'blockquote' => self::BODY_BLOCKS,
        'bulletList' => ['listItem'],
        'orderedList' => ['listItem'],
        'listItem' => self::BODY_BLOCKS,
        'codeBlock' => ['text'],
        'horizontalRule' => [],
        'hardBreak' => [],
    ];

    private const BODY_MARKS = ['bold', 'italic', 'underline', 'strike', 'code', 'link'];

    private const BODY_TEXT_ALIGNS = ['left', 'center', 'right', 'justify'];

    private const BODY_HEADING_LEVELS = [1, 2, 3];

    public function key(): string
    {
        return 'paragraph';
    }

    public function defaultConfig(): array
    {
        return ['align' => 'left', 'text_size' => 'medium'];
    }

    /**
     * Normalised rich-text body (TipTap/ProseMirror JSON doc) for a
     * paragraph slide.
     *
     * Only the node and mark types the editor uses are allowed, each only
     * inside a parent that may hold it. Unknown attrs are dropped. Link
     * hrefs must be http(s) (with a host, no credentials) or mailto, so no
     * `javascript:` / `data:` links reach participants. Text is scrubbed
     * like config text but not trimmed (spacing between styled runs
     * matters); empty text nodes are dropped. Depth, node count, total text
     * and encoded size are capped. An empty doc becomes one empty paragraph.
     *
     * @throws ValidationException (key `body`)
     */
    public static function validateBody(array $body): array
    {
        if (($body['type'] ?? null) !== 'doc') {
            self::bodyFail('The body must be a rich-text document.');
        }

        $state = ['nodes' => 0, 'text' => 0];
        $doc = self::bodyNode($body, null, 0, $state);
        $doc['content'] ??= [['type' => 'paragraph']];

        if (strlen((string) json_encode($doc)) > self::MAX_BODY_BYTES) {
            self::bodyFail('The body is too large.');
        }

        return $doc;
    }

    protected function normaliseConfig(array $config): array
    {
        return [
            'align' => $this->choice($config['align'], 'align', self::ALIGNMENTS, 'left'),
            'text_size' => $this->choice($config['text_size'], 'text_size', self::TEXT_SIZES, 'medium'),
        ];
    }

    /** @param array{nodes:int, text:int} $state running totals for the caps */
    private static function bodyNode(mixed $node, ?string $parent, int $depth, array &$state): ?array
    {
        $type = is_array($node) ? ($node['type'] ?? null) : null;
        $allowed = $parent === null ? ['doc'] : self::BODY_CHILDREN[$parent];

        // Never echo $type: it is client input and may not even be valid UTF-8.
        if (! is_string($type) || ! in_array($type, $allowed, true)) {
            self::bodyFail('The body contains an unsupported element.');
        }

        if (++$state['nodes'] > self::MAX_BODY_NODES || $depth > self::MAX_BODY_DEPTH) {
            self::bodyFail('The body is too large.');
        }

        if ($type === 'text') {
            return self::bodyText($node, $parent, $state);
        }

        $out = ['type' => $type];

        $attrs = self::bodyAttrs($type, $node['attrs'] ?? null);
        if ($attrs !== []) {
            $out['attrs'] = $attrs;
        }

        $children = $node['content'] ?? [];
        if (! is_array($children) || ! array_is_list($children)) {
            self::bodyFail('The body is not a valid rich-text document.');
        }

        $content = [];
        foreach ($children as $child) {
            if (($child = self::bodyNode($child, $type, $depth + 1, $state)) !== null) {
                $content[] = $child;
            }
        }

        if ($content !== []) {
            $out['content'] = $content;
        } elseif (in_array($type, ['bulletList', 'orderedList'], true)) {
            self::bodyFail('Lists need at least one item.');
        }

        return $out;
    }

    /** A text node, or null when nothing is left after scrubbing (ProseMirror forbids empty text). */
    private static function bodyText(array $node, string $parent, array &$state): ?array
    {
        $text = $node['text'] ?? null;
        if (! is_string($text)) {
            self::bodyFail('The body text must be text.');
        }

        $text = static::clean($text, multiline: $parent === 'codeBlock');
        if ($text === '') {
            return null;
        }

        $state['text'] += mb_strlen($text);
        if ($state['text'] > self::MAX_BODY_TEXT) {
            self::bodyFail('The body may not be longer than ' . self::MAX_BODY_TEXT . ' characters.');
        }

        $out = ['type' => 'text', 'text' => $text];

        // Code blocks take no marks in the schema.
        $marks = $parent === 'codeBlock' ? [] : self::bodyMarks($node['marks'] ?? null);
        if ($marks !== []) {
            $out['marks'] = $marks;
        }

        return $out;
    }

    /** @return list<array{type:string, attrs?:array{href:string}}> deduplicated by type */
    private static function bodyMarks(mixed $marks): array
    {
        if ($marks === null) {
            return [];
        }

        if (! is_array($marks) || ! array_is_list($marks)) {
            self::bodyFail('The body is not a valid rich-text document.');
        }

        $out = [];
        foreach ($marks as $mark) {
            $type = is_array($mark) ? ($mark['type'] ?? null) : null;
            if (! is_string($type) || ! in_array($type, self::BODY_MARKS, true)) {
                self::bodyFail('The body contains an unsupported text style.');
            }

            // Only href survives on links; target/rel are the renderer's call.
            $out[$type] ??= $type === 'link'
                ? ['type' => 'link', 'attrs' => ['href' => self::bodyHref($mark['attrs']['href'] ?? null)]]
                : ['type' => $type];
        }

        return array_values($out);
    }

    /** Known attrs only; invalid values for a known attr fail. */
    private static function bodyAttrs(string $type, mixed $attrs): array
    {
        $attrs = is_array($attrs) ? $attrs : [];
        $out = [];

        if (in_array($type, ['paragraph', 'heading'], true) && ($attrs['textAlign'] ?? null) !== null) {
            if (! in_array($attrs['textAlign'], self::BODY_TEXT_ALIGNS, true)) {
                self::bodyFail('The text alignment must be one of: ' . implode(', ', self::BODY_TEXT_ALIGNS) . '.');
            }
            $out['textAlign'] = $attrs['textAlign'];
        }

        if ($type === 'heading') {
            $level = $attrs['level'] ?? 1;
            if (! in_array($level, self::BODY_HEADING_LEVELS, true)) {
                self::bodyFail('Headings must be level 1, 2 or 3.');
            }
            $out['level'] = $level;
        }

        if ($type === 'orderedList' && ($attrs['start'] ?? null) !== null) {
            if (! is_int($attrs['start']) || $attrs['start'] < 0 || $attrs['start'] > 99999) {
                self::bodyFail('The list must start at a whole number.');
            }
            $out['start'] = $attrs['start'];
        }

        if ($type === 'codeBlock' && ($attrs['language'] ?? null) !== null) {
            if (! is_string($attrs['language']) || ! preg_match('/^[A-Za-z0-9+#._-]{1,32}\z/', $attrs['language'])) {
                self::bodyFail('The code language is invalid.');
            }
            $out['language'] = $attrs['language'];
        }

        return $out;
    }

    /**
     * An http(s) URL with a host and no credentials, or a mailto: address.
     * http is allowed (the editor's autolink defaults to it; an anchor is a
     * navigation, not mixed content); every other scheme is rejected.
     */
    private static function bodyHref(mixed $href): string
    {
        $valid = is_string($href)
            && $href !== ''
            && strlen($href) <= self::MAX_HREF
            && mb_check_encoding($href, 'UTF-8')
            && ! preg_match('/[\p{C}\p{Z}\s\\\\]/u', $href);

        $parts = $valid ? parse_url($href) : false;

        $valid = $parts !== false && match (strtolower($parts['scheme'] ?? '')) {
            'http', 'https' => ($parts['host'] ?? '') !== '' && ! isset($parts['user']) && ! isset($parts['pass']),
            'mailto' => ($parts['path'] ?? '') !== '',
            default => false,
        };

        if (! $valid) {
            self::bodyFail('Links must be http(s) or mailto addresses.');
        }

        return $href;
    }

    private static function bodyFail(string $message): never
    {
        throw ValidationException::withMessages(['body' => $message]);
    }
}
