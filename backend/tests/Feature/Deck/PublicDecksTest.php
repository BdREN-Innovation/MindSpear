<?php

use App\Models\Deck\Deck;
use App\Models\File;
use App\Models\User;
use App\Modules\FileLibrary\Services\FileStorageService;
use App\Modules\FileLibrary\Services\QuotaService;
use Database\Factories\Deck\DeckFactory;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

/*
 * Sharing v2 quizzes and quests: visibility, Discover (/public), the
 * preview, and copying someone's public deck with its images.
 */

uses(DatabaseTransactions::class);

beforeEach(function () {
    Storage::fake('local');
    config([
        'broadcasting.default' => 'null',
        'cache.default' => 'array',
        'queue.default' => 'sync',
        'file_library.disk' => 'local',
        'file_library.default_quota_mb' => 200,
        'file_library.max_image_mb' => 10,
        'file_library.max_daily_upload_mb' => 1024,
        'file_library.max_image_dimension' => 1024,
    ]);
});

function publicDeckUrl(string $path = ''): string
{
    return '/api/v1/quests/v2' . $path;
}

/** A PNG with random pixels, so two are never de-duplicated. */
function publicDeckImage(User $user): File
{
    $image = imagecreatetruecolor(40, 30);
    imagefilledrectangle($image, 0, 0, 39, 29, imagecolorallocate($image, random_int(0, 255), random_int(0, 255), random_int(0, 255)));
    for ($i = 0; $i < 8; $i++) {
        imagesetpixel($image, random_int(0, 39), random_int(0, 29), imagecolorallocate($image, random_int(0, 255), random_int(0, 255), random_int(0, 255)));
    }
    $path = tempnam(sys_get_temp_dir(), 'pubdeck');
    imagepng($image, $path);

    return app(FileStorageService::class)->store($user, new UploadedFile($path, 'pic.png', 'image/png', null, true))['file'];
}

/**
 * A quest owned by $owner with a cover, an image slide and a poll whose
 * first option has an image (all three the same file when $shared).
 *
 * @return array{deck: Deck, files: list<File>}
 */
function publicDeckWithImages(User $owner, string $title = 'Shared quest', bool $public = true): array
{
    Sanctum::actingAs($owner);
    $deck = test()->postJson(publicDeckUrl(), ['title' => $title, 'visibility' => $public ? 'public' : 'private'])->assertCreated()->json('data.deck');
    $files = [publicDeckImage($owner), publicDeckImage($owner), publicDeckImage($owner)];

    test()->putJson(publicDeckUrl("/{$deck['id']}/cover"), ['file_id' => $files[0]->id])->assertOk();

    $image = test()->postJson(publicDeckUrl("/{$deck['id']}/slides"), ['type' => 'image'])->assertCreated()->json('data.slide');
    test()->putJson(publicDeckUrl("/{$deck['id']}/slides/{$image['id']}/media"), ['file_id' => $files[1]->id])->assertOk();

    $poll = test()->postJson(publicDeckUrl("/{$deck['id']}/slides"), ['type' => 'poll_single'])->assertCreated()->json('data.slide');
    test()->putJson(publicDeckUrl("/{$deck['id']}/slides/{$poll['id']}/options/{$poll['options'][0]['id']}/image"), ['file_id' => $files[2]->id])->assertOk();

    return ['deck' => Deck::find($deck['id']), 'files' => $files];
}

it('keeps new decks private and lets the owner make one public', function () {
    Sanctum::actingAs(DeckFactory::newOwner());

    $deck = $this->postJson(publicDeckUrl(), ['title' => 'Mine'])->assertCreated()->json('data.deck');
    expect($deck['visibility'])->toBe('private');

    $this->patchJson(publicDeckUrl("/{$deck['id']}"), ['visibility' => 'public'])
        ->assertOk()
        ->assertJsonPath('data.deck.visibility', 'public');
    expect(Deck::find($deck['id'])->visibility)->toBe('public');

    $this->patchJson(publicDeckUrl("/{$deck['id']}"), ['visibility' => 'everyone'])->assertStatus(422);

    // Only the owner can change it.
    Sanctum::actingAs(DeckFactory::newOwner());
    $this->patchJson(publicDeckUrl("/{$deck['id']}"), ['visibility' => 'private'])->assertNotFound();
    expect(Deck::find($deck['id'])->visibility)->toBe('public');
});

it('lists only live public decks of the product in Discover', function () {
    $owner = DeckFactory::newOwner();
    $shared = Deck::factory()->create(['owner_id' => $owner->id, 'title' => 'Volcano quest', 'visibility' => 'public']);
    Deck::factory()->create(['owner_id' => $owner->id, 'title' => 'Private quest']);
    Deck::factory()->create(['owner_id' => $owner->id, 'title' => 'Deleted quest', 'visibility' => 'public'])->delete();
    Deck::factory()->create(['owner_id' => $owner->id, 'title' => 'A quiz', 'product' => 'quiz', 'visibility' => 'public']);

    $viewer = DeckFactory::newOwner();
    Sanctum::actingAs($viewer);

    $items = collect($this->getJson(publicDeckUrl('/public?per_page=50'))->assertOk()->json('data.items'));
    $ours = $items->whereIn('title', ['Volcano quest', 'Private quest', 'Deleted quest', 'A quiz']);
    expect($ours->pluck('title')->all())->toBe(['Volcano quest'])
        ->and($ours->first())->toMatchArray([
            'id' => $shared->id,
            'visibility' => 'public',
            'copyCount' => 0,
            'isMine' => false,
            'creator' => ['id' => $owner->id, 'name' => 'Deck Owner', 'avatar' => null],
        ]);

    $search = $this->getJson(publicDeckUrl('/public?search=volcano'))->assertOk()->json('data.items');
    expect(collect($search)->pluck('id')->all())->toBe([$shared->id]);

    $this->getJson(publicDeckUrl('/public?sort=popular'))->assertOk();
    $this->getJson(publicDeckUrl('/public?sort=random'))->assertStatus(422);
});

it('previews a public deck to anyone signed in, a private one only to its owner', function () {
    $owner = DeckFactory::newOwner();
    $public = Deck::factory()->create(['owner_id' => $owner->id, 'visibility' => 'public']);
    $private = Deck::factory()->create(['owner_id' => $owner->id]);

    Sanctum::actingAs(DeckFactory::newOwner());
    $this->getJson(publicDeckUrl("/public/{$public->id}"))->assertOk()
        ->assertJsonPath('data.deck.id', $public->id)
        ->assertJsonPath('data.deck.isMine', false)
        ->assertJsonStructure(['data' => ['deck' => ['slides', 'creator', 'copyCount']]]);
    $this->getJson(publicDeckUrl("/public/{$private->id}"))->assertNotFound();
    $this->postJson(publicDeckUrl("/public/{$private->id}/copy"))->assertNotFound();

    Sanctum::actingAs($owner);
    $this->getJson(publicDeckUrl("/public/{$private->id}"))->assertOk()->assertJsonPath('data.deck.isMine', true);
});

it('copies a public deck with its images into the copier\'s own library', function () {
    $owner = DeckFactory::newOwner();
    ['deck' => $source, 'files' => $files] = publicDeckWithImages($owner);
    $quota = app(QuotaService::class);
    $ownerUsed = $quota->usedBy($owner->id);
    $imageBytes = collect($files)->sum('size');

    $copier = DeckFactory::newOwner();
    Sanctum::actingAs($copier);
    $copy = $this->postJson(publicDeckUrl("/public/{$source->id}/copy"))->assertCreated()->json('data.deck');

    $deck = Deck::find($copy['id']);
    expect($deck->owner_id)->toBe($copier->id)
        ->and($deck->title)->toBe('Shared quest')
        ->and($deck->visibility)->toBe('private')
        ->and($deck->source_deck_id)->toBe($source->id)
        ->and($copy['slides'])->toHaveCount(3);

    // The copier owns new rows on the same stored bytes; nothing is written twice.
    $copied = File::whereIn('id', [$deck->cover_file_id, $copy['slides'][1]['mediaFileId'], $copy['slides'][2]['options'][0]['imageFileId']])->get();
    expect($copied)->toHaveCount(3)
        ->and($copied->pluck('user_id')->unique()->all())->toBe([$copier->id])
        ->and($copied->pluck('disk_path')->sort()->values()->all())->toBe(collect($files)->pluck('disk_path')->sort()->values()->all())
        ->and($quota->usedBy($copier->id))->toBe($imageBytes)
        ->and($quota->usedBy($owner->id))->toBe($ownerUsed);

    // A second copy reuses the copier's rows: no extra quota.
    $again = $this->postJson(publicDeckUrl("/public/{$source->id}/copy"))->assertCreated()->json('data.deck');
    expect(Deck::find($again['id'])->cover_file_id)->toBe($deck->cover_file_id)
        ->and($quota->usedBy($copier->id))->toBe($imageBytes);

    // Discover counts the copies.
    expect($this->getJson(publicDeckUrl("/public/{$source->id}"))->json('data.deck.copyCount'))->toBe(2);
});

it('keeps a copy working when the owner deletes or replaces the original images', function () {
    $owner = DeckFactory::newOwner();
    ['deck' => $source, 'files' => $files] = publicDeckWithImages($owner);

    $copier = DeckFactory::newOwner();
    Sanctum::actingAs($copier);
    $copy = $this->postJson(publicDeckUrl("/public/{$source->id}/copy"))->assertCreated()->json('data.deck');
    $copyCover = File::find(Deck::find($copy['id'])->cover_file_id);

    $storage = app(FileStorageService::class);
    $storage->delete($files[0], $owner);
    $storage->replace($owner, $files[1]->fresh(), UploadedFile::fake()->image('new.png', 20, 20));

    // The owner's delete is soft and the replaced bytes are still used by the copy: both stay on disk.
    expect(File::find($copyCover->id))->not->toBeNull()
        ->and(Storage::disk('local')->exists($files[0]->disk_path))->toBeTrue()
        ->and(Storage::disk('local')->exists($files[1]->disk_path))->toBeTrue();

    $slides = $this->getJson(publicDeckUrl("/{$copy['id']}"))->assertOk()->json('data.deck.slides');
    expect($slides[1]['media']['url'])->toContain(basename($files[1]->disk_path))
        ->and($slides[1]['media']['inLibrary'])->toBeTrue();
});

it('deletes replaced bytes nobody else uses', function () {
    $owner = DeckFactory::newOwner();
    $file = publicDeckImage($owner);
    $old = $file->disk_path;

    app(FileStorageService::class)->replace($owner, $file, UploadedFile::fake()->image('new.png', 20, 20));

    expect(Storage::disk('local')->exists($old))->toBeFalse();
});

it('refuses a copy whose images do not fit the copier\'s storage, and copies nothing', function () {
    $owner = DeckFactory::newOwner();
    ['deck' => $source] = publicDeckWithImages($owner);

    $copier = DeckFactory::newOwner();
    $copier->forceFill(['storage_quota_bytes' => 10])->save();
    Sanctum::actingAs($copier);

    $this->postJson(publicDeckUrl("/public/{$source->id}/copy"))
        ->assertStatus(422)
        ->assertJsonPath('data.code', 'quota_exceeded');

    expect(Deck::where('owner_id', $copier->id)->count())->toBe(0)
        ->and(File::where('user_id', $copier->id)->count())->toBe(0);
});

it('duplicates your own public deck as "Copy of" with the same files', function () {
    $owner = DeckFactory::newOwner();
    ['deck' => $source] = publicDeckWithImages($owner, 'Own quest');

    Sanctum::actingAs($owner);
    $copy = $this->postJson(publicDeckUrl("/public/{$source->id}/copy"))->assertCreated()->json('data.deck');

    $deck = Deck::find($copy['id']);
    expect($deck->title)->toBe('Copy of Own quest')
        ->and($deck->visibility)->toBe('private')
        ->and($deck->source_deck_id)->toBeNull()
        ->and($deck->cover_file_id)->toBe($source->cover_file_id);
});
