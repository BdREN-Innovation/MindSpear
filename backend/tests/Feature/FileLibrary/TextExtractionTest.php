<?php

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

uses(DatabaseTransactions::class);

beforeEach(function () {
    Storage::fake('local');
    config(['cache.default' => 'array', 'file_library.disk' => 'local', 'file_library.default_quota_mb' => 100]);
    Sanctum::actingAs(User::create([
        'first_name' => 'Text',
        'last_name' => 'Reader',
        'email' => 'text-' . str()->uuid() . '@example.test',
        'email_verified_at' => now(),
        'is_verified' => true,
        'password' => Hash::make('password'),
    ]));
});

/** Builds an Office file from [entry => xml] in a temp file. */
function libOfficeFile(string $name, array $entries): UploadedFile
{
    $path = tempnam(sys_get_temp_dir(), 'office');
    $zip = new ZipArchive;
    $zip->open($path, ZipArchive::OVERWRITE);
    foreach ($entries as $entry => $xml) {
        $zip->addFromString($entry, $xml);
    }
    $zip->close();

    return new UploadedFile($path, $name, null, null, true);
}

function libDocx(string $body): UploadedFile
{
    $w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

    return libOfficeFile('notes.docx', [
        '[Content_Types].xml' => '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
        'word/document.xml' => "<?xml version=\"1.0\" encoding=\"UTF-8\"?><w:document xmlns:w=\"{$w}\"><w:body>{$body}</w:body></w:document>",
    ]);
}

function libParagraph(string $text, ?string $style = null): string
{
    $props = $style ? "<w:pPr><w:pStyle w:val=\"{$style}\"/></w:pPr>" : '';

    return "<w:p>{$props}<w:r><w:t>{$text}</w:t></w:r></w:p>";
}

function libPages(UploadedFile $file): array
{
    $id = test()->post('/api/v1/library/files', ['file' => $file], ['Accept' => 'application/json'])->assertCreated()->json('data.file.id');

    return test()->getJson("/api/v1/library/files/{$id}/pages")->assertOk()->json('data');
}

it('splits a docx on its saved page breaks and flattens tables', function () {
    $body = libParagraph('Cells are the unit of life.')
        . '<w:tbl><w:tr><w:tc>' . libParagraph('Organelle') . '</w:tc><w:tc>' . libParagraph('Role') . '</w:tc></w:tr>'
        . '<w:tr><w:tc>' . libParagraph('Nucleus') . '</w:tc><w:tc>' . libParagraph('Holds DNA') . '</w:tc></w:tr></w:tbl>'
        . '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
        . libParagraph('Mitochondria make energy.');

    $data = libPages(libDocx($body));

    expect($data['kind'])->toBe('text')
        ->and($data['pages'])->toHaveCount(2)
        ->and($data['pages'][0]['label'])->toBe('Page 1')
        ->and($data['pages'][0]['text'])->toBe("Cells are the unit of life.\nOrganelle | Role\nNucleus | Holds DNA")
        ->and($data['pages'][1]['text'])->toBe('Mitochondria make energy.')
        ->and($data['pages'][1]['word_count'])->toBe(3);
});

it('uses headings as sections when a docx has no page breaks', function () {
    $body = libParagraph('Introduction', 'Heading1') . libParagraph('Plants need light.')
        . libParagraph('Photosynthesis', 'Heading1') . libParagraph('Chlorophyll absorbs light.');

    $pages = libPages(libDocx($body))['pages'];

    expect(array_column($pages, 'label'))->toBe(['Section 1: Introduction', 'Section 2: Photosynthesis'])
        ->and($pages[1]['text'])->toBe("Photosynthesis\nChlorophyll absorbs light.");
});

it('returns the docx headings as an outline of chapters', function () {
    $outlineLvl = fn (string $text, int $lvl) => "<w:p><w:pPr><w:outlineLvl w:val=\"{$lvl}\"/></w:pPr><w:r><w:t>{$text}</w:t></w:r></w:p>";
    $pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    $body = libParagraph('Chapter 1: Cells', 'Heading1') . libParagraph('Cells are small.')
        . $pageBreak . libParagraph('1.1 Organelles', 'Heading2') . libParagraph('Mitochondria make energy.')
        . $pageBreak . $outlineLvl('Chapter 2: Plants', 0) . libParagraph('Plants photosynthesise.')
        . $pageBreak . libParagraph('Chapter 3: Animals', 'Heading1') . libParagraph('Animals move.');

    $data = libPages(libDocx($body));

    // jsonb doesn't keep key order, so compare with toEqual.
    expect($data['pages'])->toHaveCount(4)
        ->and($data['outline'])->toEqual([
            ['title' => 'Chapter 1: Cells', 'level' => 1, 'page' => 1],
            ['title' => '1.1 Organelles', 'level' => 2, 'page' => 2],
            ['title' => 'Chapter 2: Plants', 'level' => 1, 'page' => 3],
            ['title' => 'Chapter 3: Animals', 'level' => 1, 'page' => 4],
        ]);
});

it('builds the outline from headings when a docx has no page breaks', function () {
    $body = libParagraph('Introduction', 'Heading1') . libParagraph('Plants need light.')
        . libParagraph('Light', 'Heading2') . libParagraph('Sunlight is energy.');

    $data = libPages(libDocx($body));

    expect($data['outline'])->toEqual([
        ['title' => 'Introduction', 'level' => 1, 'page' => 1],
        ['title' => 'Light', 'level' => 2, 'page' => 2],
    ]);
});

it('has no outline for plain text', function () {
    expect(libPages(UploadedFile::fake()->createWithContent('notes.txt', str_repeat('Some words here. ', 10)))['outline'])->toBe([]);
});

it('reads pptx slides in presentation order with titles and speaker notes', function () {
    $p = 'http://schemas.openxmlformats.org/presentationml/2006/main';
    $a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    $r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    $rel = 'http://schemas.openxmlformats.org/package/2006/relationships';
    $slide = fn (string $title, string $body) => "<?xml version=\"1.0\"?><p:sld xmlns:p=\"{$p}\" xmlns:a=\"{$a}\"><p:cSld><p:spTree>"
        . "<p:sp><p:nvSpPr><p:cNvPr id=\"1\" name=\"t\"/><p:cNvSpPr/><p:nvPr><p:ph type=\"title\"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>{$title}</a:t></a:r></a:p></p:txBody></p:sp>"
        . "<p:sp><p:nvSpPr><p:cNvPr id=\"2\" name=\"b\"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:txBody><a:p><a:r><a:t>{$body}</a:t></a:r></a:p></p:txBody></p:sp>"
        . '</p:spTree></p:cSld></p:sld>';

    $file = libOfficeFile('deck.pptx', [
        '[Content_Types].xml' => '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
        // slide2.xml is shown first.
        'ppt/presentation.xml' => "<?xml version=\"1.0\"?><p:presentation xmlns:p=\"{$p}\" xmlns:r=\"{$r}\"><p:sldIdLst><p:sldId id=\"256\" r:id=\"rId3\"/><p:sldId id=\"257\" r:id=\"rId2\"/></p:sldIdLst></p:presentation>",
        'ppt/_rels/presentation.xml.rels' => "<?xml version=\"1.0\"?><Relationships xmlns=\"{$rel}\"><Relationship Id=\"rId2\" Type=\"http://x/slide\" Target=\"slides/slide1.xml\"/><Relationship Id=\"rId3\" Type=\"http://x/slide\" Target=\"slides/slide2.xml\"/></Relationships>",
        'ppt/slides/slide1.xml' => $slide('Summary', 'Light becomes sugar.'),
        'ppt/slides/slide2.xml' => $slide('Overview', 'Plants make food.'),
        'ppt/slides/_rels/slide2.xml.rels' => "<?xml version=\"1.0\"?><Relationships xmlns=\"{$rel}\"><Relationship Id=\"rId1\" Type=\"http://x/notesSlide\" Target=\"../notesSlides/notesSlide1.xml\"/></Relationships>",
        'ppt/notesSlides/notesSlide1.xml' => "<?xml version=\"1.0\"?><p:notes xmlns:p=\"{$p}\" xmlns:a=\"{$a}\"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id=\"1\" name=\"n\"/><p:cNvSpPr/><p:nvPr><p:ph type=\"body\"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Mention chlorophyll.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>",
    ]);

    $pages = libPages($file)['pages'];

    expect(array_column($pages, 'label'))->toBe(['Slide 1: Overview', 'Slide 2: Summary'])
        ->and($pages[0]['text'])->toBe("Overview\nPlants make food.\nNotes: Mention chlorophyll.")
        ->and($pages[1]['text'])->toBe("Summary\nLight becomes sugar.");
});

it('splits plain text into sections and keeps Bangla text intact', function () {
    config(['file_library.section_words' => 100]);
    $long = implode("\n\n", array_fill(0, 3, trim(str_repeat('word ', 60))));
    $pages = libPages(UploadedFile::fake()->createWithContent('notes.txt', "আমার সোনার বাংলা\n\n" . $long))['pages'];

    expect($pages)->toHaveCount(3)
        ->and($pages[0]['text'])->toStartWith('আমার সোনার বাংলা')
        ->and($pages[0]['word_count'])->toBe(63);
});

it('does not fail the upload when a document is too large to read', function () {
    config(['file_library.max_extract_bytes' => 100]);
    $file = libDocx(str_repeat(libParagraph('Too much text here.'), 20));

    $upload = test()->post('/api/v1/library/files', ['file' => $file], ['Accept' => 'application/json'])->assertCreated();
    $upload->assertJsonPath('data.file.extractionStatus', 'failed');

    test()->getJson('/api/v1/library/files/' . $upload->json('data.file.id') . '/pages')
        ->assertStatus(422)->assertJsonPath('data.code', 'invalid_file');
});

it('tells the client to read pdfs in the browser', function () {
    $data = libPages(UploadedFile::fake()->create('slides.pdf', 10, 'application/pdf'));

    expect($data['kind'])->toBe('pdf')->and($data['pages'])->toBe([]);
});
