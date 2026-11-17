<?php

use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\Types\Content\ContentSlideType;
use App\Deck\Slides\Types\Content\ParagraphSlideType;
use Illuminate\Validation\ValidationException;

/*
 * Config validation for the text content types (heading, paragraph,
 * bullets, numbered, quote, big_text) and the paragraph rich-text body.
 */

function deckContentTextConfig(string $key, array $config): array
{
    return app(SlideTypeRegistry::class)->for($key)->validateConfig($config);
}

/** The ValidationException errors for an invalid config (fails the test when it validates). */
function deckContentTextErrors(string $key, array $config): array
{
    try {
        deckContentTextConfig($key, $config);
    } catch (ValidationException $e) {
        return $e->errors();
    }

    test()->fail("Config for [{$key}] unexpectedly validated: " . json_encode($config));
}

/** A TipTap doc with the given block nodes. */
function deckContentTextDoc(array ...$blocks): array
{
    return ['type' => 'doc', 'content' => $blocks];
}

/** A paragraph node holding one text run with optional marks. */
function deckContentTextParagraph(string $text, array $marks = []): array
{
    $run = ['type' => 'text', 'text' => $text];

    return ['type' => 'paragraph', 'content' => [$marks === [] ? $run : $run + ['marks' => $marks]]];
}

/** The `body` errors for an invalid body (fails the test when it validates). */
function deckContentTextBodyErrors(array $body): array
{
    try {
        ParagraphSlideType::validateBody($body);
    } catch (ValidationException $e) {
        return $e->errors();
    }

    test()->fail('Body unexpectedly validated: ' . json_encode($body));
}

it('normalises heading subtitle: strips control characters and trims', function () {
    $config = deckContentTextConfig('heading', ['subtitle' => "  Hello\x00\x07 <b>world</b>\n "]);

    // Not HTML-escaped (the frontend escapes); controls stripped, line breaks flattened.
    expect($config)->toBe(['subtitle' => 'Hello <b>world</b>'])
        ->and(deckContentTextConfig('heading', ['subtitle' => "   \t "]))->toBe(['subtitle' => null]);
});

it('rejects bad heading config with bare keys', function (array $config, string $errorKey) {
    expect(deckContentTextErrors('heading', $config))->toHaveKey($errorKey);
})->with([
    'subtitle too long' => [['subtitle' => str_repeat('é', 251)], 'subtitle'],
    'subtitle not text' => [['subtitle' => true], 'subtitle'],
]);

it('counts length in characters, not bytes', function () {
    expect(deckContentTextConfig('heading', ['subtitle' => str_repeat('é', 250)])['subtitle'])->toBe(str_repeat('é', 250))
        ->and(deckContentTextConfig('big_text', ['text' => str_repeat('漢', 80)])['text'])->toBe(str_repeat('漢', 80));
});

it('scrubs invalid UTF-8 and bidi overrides', function () {
    expect(ContentSlideType::sanitize("ab\xFFcd"))->toBe('ab?cd')
        ->and(ContentSlideType::sanitize("evil\u{202E}txt.exe"))->toBe('eviltxt.exe')
        ->and(ContentSlideType::sanitize("a\r\nb\rc\td", true))->toBe("a\nb\nc d")
        ->and(ContentSlideType::sanitize("a\r\nb", false))->toBe('a b');
});

it('validates paragraph layout options', function () {
    expect(deckContentTextConfig('paragraph', ['align' => 'right', 'text_size' => 'small']))->toBe(['align' => 'right', 'text_size' => 'small'])
        ->and(deckContentTextErrors('paragraph', ['align' => 'justify']))->toHaveKey('align')
        ->and(deckContentTextErrors('paragraph', ['text_size' => 'huge']))->toHaveKey('text_size')
        ->and(deckContentTextErrors('paragraph', ['align' => 1]))->toHaveKey('align');
});

it('normalises list items for bullets and numbered', function (string $key) {
    expect(deckContentTextConfig($key, ['items' => [" One\x01 ", 'Two', '', 3]]))->toBe(['items' => ['One', 'Two', '', '3']])
        ->and(deckContentTextConfig($key, ['items' => array_fill(0, 20, 'x')])['items'])->toHaveCount(20);
})->with(['bullets', 'numbered']);

it('rejects bad list items for bullets and numbered', function (string $key, array $config, string $errorKey) {
    expect(deckContentTextErrors($key, $config))->toHaveKey($errorKey);
})->with(['bullets', 'numbered'])->with([
    'empty list' => [['items' => []], 'items'],
    'too many' => [['items' => array_fill(0, 21, 'x')], 'items'],
    'not a list' => [['items' => 'one, two'], 'items'],
    'keyed map' => [['items' => ['a' => 'One']], 'items'],
    'null' => [['items' => null], 'items'],
    'item too long' => [['items' => ['ok', str_repeat('a', 201)]], 'items.1'],
    'item not text' => [['items' => ['ok', ['nested']]], 'items.1'],
]);

it('keeps line breaks in quote text but not in the attribution', function () {
    expect(deckContentTextConfig('quote', ['text' => "Line one\r\nLine two\x0B", 'attribution' => "Ada\nLovelace"]))
        ->toBe(['text' => "Line one\nLine two", 'attribution' => 'Ada Lovelace'])
        ->and(deckContentTextConfig('quote', ['text' => 'Only text'])['attribution'])->toBeNull();
});

it('rejects bad quote config', function (array $config, string $errorKey) {
    expect(deckContentTextErrors('quote', $config))->toHaveKey($errorKey);
})->with([
    'text too long' => [['text' => str_repeat('a', 501)], 'text'],
    'attribution too long' => [['attribution' => str_repeat('a', 121)], 'attribution'],
    'text not text' => [['text' => ['x']], 'text'],
]);

it('enforces the big_text 80 character limit', function () {
    expect(deckContentTextConfig('big_text', ['text' => str_repeat('a', 80)])['text'])->toHaveLength(80)
        ->and(deckContentTextErrors('big_text', ['text' => str_repeat('a', 81)]))->toHaveKey('text')
        ->and(deckContentTextErrors('big_text', ['text' => (object) []]))->toHaveKey('text');
});

it('reports every invalid field at once, with bare keys like the Quest types', function () {
    $errors = deckContentTextErrors('quote', ['text' => str_repeat('a', 501), 'attribution' => str_repeat('b', 121)]);

    expect(array_keys($errors))->toBe(['text', 'attribution']);
});

// --- Paragraph rich-text body --------------------------------------------------

it('keeps a well-formed editor document, dropping unknown attrs', function () {
    $body = deckContentTextDoc(
        ['type' => 'heading', 'attrs' => ['level' => 2, 'textAlign' => 'center', 'id' => 'x'], 'content' => [['type' => 'text', 'text' => 'Agenda']]],
        ['type' => 'paragraph', 'attrs' => ['textAlign' => null], 'content' => [
            ['type' => 'text', 'text' => 'Read '],
            ['type' => 'text', 'text' => 'the docs', 'marks' => [
                ['type' => 'bold'],
                ['type' => 'link', 'attrs' => ['href' => 'https://example.test/docs', 'target' => '_self', 'rel' => 'opener', 'class' => 'x']],
                ['type' => 'bold'],
            ]],
            ['type' => 'hardBreak'],
            ['type' => 'text', 'text' => 'or mail us', 'marks' => [['type' => 'link', 'attrs' => ['href' => 'mailto:team@example.test']]]],
        ]],
        ['type' => 'orderedList', 'attrs' => ['start' => 3], 'content' => [
            ['type' => 'listItem', 'content' => [deckContentTextParagraph('Three')]],
        ]],
        ['type' => 'blockquote', 'content' => [
            ['type' => 'bulletList', 'content' => [['type' => 'listItem', 'content' => [deckContentTextParagraph('Nested', [['type' => 'italic']])]]]],
        ]],
        ['type' => 'codeBlock', 'attrs' => ['language' => 'php'], 'content' => [['type' => 'text', 'text' => "a\n\tb", 'marks' => [['type' => 'bold']]]]],
        ['type' => 'horizontalRule'],
    );

    expect(ParagraphSlideType::validateBody($body))->toBe(deckContentTextDoc(
        ['type' => 'heading', 'attrs' => ['textAlign' => 'center', 'level' => 2], 'content' => [['type' => 'text', 'text' => 'Agenda']]],
        ['type' => 'paragraph', 'content' => [
            ['type' => 'text', 'text' => 'Read '],
            ['type' => 'text', 'text' => 'the docs', 'marks' => [['type' => 'bold'], ['type' => 'link', 'attrs' => ['href' => 'https://example.test/docs']]]],
            ['type' => 'hardBreak'],
            ['type' => 'text', 'text' => 'or mail us', 'marks' => [['type' => 'link', 'attrs' => ['href' => 'mailto:team@example.test']]]],
        ]],
        ['type' => 'orderedList', 'attrs' => ['start' => 3], 'content' => [
            ['type' => 'listItem', 'content' => [deckContentTextParagraph('Three')]],
        ]],
        ['type' => 'blockquote', 'content' => [
            ['type' => 'bulletList', 'content' => [['type' => 'listItem', 'content' => [deckContentTextParagraph('Nested', [['type' => 'italic']])]]]],
        ]],
        ['type' => 'codeBlock', 'attrs' => ['language' => 'php'], 'content' => [['type' => 'text', 'text' => "a\n b"]]],
        ['type' => 'horizontalRule'],
    ));
});

it('scrubs body text without trimming and drops runs left empty', function () {
    $body = deckContentTextDoc(['type' => 'paragraph', 'content' => [
        ['type' => 'text', 'text' => "Hi\u{202E} \x00"],
        ['type' => 'text', 'text' => "\x07"],
        ['type' => 'text', 'text' => "there\nfriend ", 'marks' => [['type' => 'bold']]],
        ['type' => 'text', 'text' => "bad\xFF"],
    ]]);

    expect(ParagraphSlideType::validateBody($body)['content'][0]['content'])->toBe([
        ['type' => 'text', 'text' => 'Hi '],
        ['type' => 'text', 'text' => 'there friend ', 'marks' => [['type' => 'bold']]],
        ['type' => 'text', 'text' => 'bad?'],
    ]);
});

it('turns an empty document into one empty paragraph', function () {
    expect(ParagraphSlideType::validateBody(['type' => 'doc']))->toBe(deckContentTextDoc(['type' => 'paragraph']))
        ->and(ParagraphSlideType::validateBody(deckContentTextDoc()))->toBe(deckContentTextDoc(['type' => 'paragraph']));
});

it('accepts http, https and mailto links', function (string $href) {
    $doc = ParagraphSlideType::validateBody(deckContentTextDoc(deckContentTextParagraph('x', [['type' => 'link', 'attrs' => ['href' => $href]]])));

    expect($doc['content'][0]['content'][0]['marks'][0]['attrs'])->toBe(['href' => $href]);
})->with(['https://example.test/a?b=c#d', 'http://example.test', 'HTTPS://Example.test/', 'mailto:ada@example.test']);

it('rejects unsafe link hrefs', function (mixed $href) {
    $body = deckContentTextDoc(deckContentTextParagraph('click', [['type' => 'link', 'attrs' => ['href' => $href]]]));

    expect(deckContentTextBodyErrors($body))->toHaveKey('body');
})->with([
    'javascript' => ['javascript:alert(document.cookie)'],
    'javascript upper-case' => ['JaVaScRiPt:alert(1)'],
    'javascript with tab' => ["java\tscript:alert(1)"],
    'javascript leading space' => [' javascript:alert(1)'],
    'data' => ['data:text/html;base64,PHNjcmlwdD4='],
    'vbscript' => ['vbscript:msgbox(1)'],
    'file' => ['file:///etc/passwd'],
    'protocol relative' => ['//evil.test/x'],
    'relative path' => ['/admin'],
    'no host' => ['https:evil.test'],
    'credentials' => ['https://bank.test@evil.test/'],
    'backslash' => ['https://evil.test\\@good.test'],
    'bidi override' => ["https://example.test/\u{202E}gpj.exe"],
    'non-breaking space' => ["https://example.test/a\u{00A0}b"],
    'invalid utf-8' => ["https://example.test/\xFF"],
    'empty mailto' => ['mailto:'],
    'missing' => [null],
    'not a string' => [['https://example.test']],
    'too long' => ['https://example.test/' . str_repeat('a', 2048)],
]);

it('rejects nodes, marks and attrs outside the allowlist', function (array $body) {
    expect(deckContentTextBodyErrors($body))->toHaveKey('body');
})->with([
    'not a doc' => [['type' => 'paragraph']],
    'missing type' => [['content' => []]],
    'script node' => [deckContentTextDoc(['type' => 'script', 'content' => [['type' => 'text', 'text' => 'x']]])],
    'image node' => [deckContentTextDoc(['type' => 'image', 'attrs' => ['src' => 'https://tracker.evil.test/p.gif']])],
    'iframe in paragraph' => [deckContentTextDoc(['type' => 'paragraph', 'content' => [['type' => 'iframe']]])],
    'text at doc level' => [deckContentTextDoc(['type' => 'text', 'text' => 'loose'])],
    'paragraph in paragraph' => [deckContentTextDoc(['type' => 'paragraph', 'content' => [deckContentTextParagraph('x')]])],
    'list item outside a list' => [deckContentTextDoc(['type' => 'listItem', 'content' => [deckContentTextParagraph('x')]])],
    'empty list' => [deckContentTextDoc(['type' => 'bulletList', 'content' => []])],
    'child under horizontal rule' => [deckContentTextDoc(['type' => 'horizontalRule', 'content' => [deckContentTextParagraph('x')]])],
    'nested doc' => [deckContentTextDoc(['type' => 'doc', 'content' => []])],
    'content not a list' => [deckContentTextDoc(['type' => 'paragraph', 'content' => ['a' => ['type' => 'text', 'text' => 'x']]])],
    'node not an object' => [['type' => 'doc', 'content' => ['paragraph']]],
    'text not a string' => [deckContentTextDoc(['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => ['x']]]])],
    'unknown mark' => [deckContentTextDoc(deckContentTextParagraph('x', [['type' => 'textStyle', 'attrs' => ['color' => 'red']]]))],
    'marks not a list' => [deckContentTextDoc(deckContentTextParagraph('x', ['type' => 'bold']))],
    'heading level 4' => [deckContentTextDoc(['type' => 'heading', 'attrs' => ['level' => 4]])],
    'heading level string' => [deckContentTextDoc(['type' => 'heading', 'attrs' => ['level' => '1']])],
    'bad text align' => [deckContentTextDoc(['type' => 'paragraph', 'attrs' => ['textAlign' => 'expression(alert(1))']])],
    'bad list start' => [deckContentTextDoc(['type' => 'orderedList', 'attrs' => ['start' => -1], 'content' => [['type' => 'listItem', 'content' => [deckContentTextParagraph('x')]]]])],
    'bad code language' => [deckContentTextDoc(['type' => 'codeBlock', 'attrs' => ['language' => '"><script>']])],
]);

it('caps body text, node count, depth and encoded size', function () {
    $nest = function (int $levels): array {
        $node = deckContentTextParagraph('deep');
        for ($i = 0; $i < $levels; $i++) {
            $node = ['type' => 'blockquote', 'content' => [$node]];
        }

        return deckContentTextDoc($node);
    };

    $many = array_fill(0, ParagraphSlideType::MAX_BODY_NODES, ['type' => 'horizontalRule']);
    $linked = array_fill(0, 40, deckContentTextParagraph('x', [['type' => 'link', 'attrs' => ['href' => 'https://example.test/' . str_repeat('a', 2000)]]]));

    expect(ParagraphSlideType::validateBody(deckContentTextDoc(deckContentTextParagraph(str_repeat('é', 5000)))))->toBeArray()
        ->and(deckContentTextBodyErrors(deckContentTextDoc(deckContentTextParagraph(str_repeat('a', 3000)), deckContentTextParagraph(str_repeat('b', 2001)))))->toHaveKey('body')
        ->and(deckContentTextBodyErrors(deckContentTextDoc(...$many)))->toHaveKey('body')
        ->and(ParagraphSlideType::validateBody($nest(8)))->toBeArray()
        ->and(deckContentTextBodyErrors($nest(ParagraphSlideType::MAX_BODY_DEPTH)))->toHaveKey('body')
        ->and(deckContentTextBodyErrors(deckContentTextDoc(...$linked)))->toHaveKey('body');
});

it('never echoes client input in body errors', function () {
    $errors = deckContentTextBodyErrors(deckContentTextDoc(['type' => "evil\xFF<script>"]));

    expect(json_encode($errors))->not->toBeFalse()
        ->and(json_encode($errors))->not->toContain('script');
});
