<?php

namespace App\Modules\FileLibrary\Services;

use App\Models\File;
use App\Models\User;
use App\Modules\FileLibrary\Exceptions\FileLibraryException;
use App\Modules\FileLibrary\Models\FileTextContent;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

/**
 * Saves uploads into the user's library: checks type and size, reuses an
 * identical file the user already has, enforces the quota and extracts
 * document text. Images are public (/storage/library/...); documents are
 * private and only served through the library API.
 */
class FileStorageService
{
    /** Server-detected MIME types accepted for each extension. */
    private const MIME_TYPES = [
        'jpg' => ['image/jpeg'],
        'jpeg' => ['image/jpeg'],
        'png' => ['image/png'],
        'gif' => ['image/gif'],
        'webp' => ['image/webp'],
        'pdf' => ['application/pdf', 'application/x-pdf'],
        'docx' => ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream'],
        'pptx' => ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip', 'application/octet-stream'],
        'txt' => ['text/*'],
    ];

    public function __construct(
        private readonly QuotaService $quota,
        private readonly TextExtractionService $extractor,
    ) {}

    /**
     * @return array{file: File, deduplicated: bool}
     */
    public function store(User $user, UploadedFile $upload, ?string $name = null): array
    {
        [$extension, $category, $mime] = $this->inspect($upload);
        $size = (int) $upload->getSize();
        $checksum = hash_file('sha256', $upload->getRealPath());

        // Same bytes already in the library: reuse them, no extra quota.
        $existing = File::where('user_id', $user->id)->where('checksum', $checksum)->where('category', $category)->first();
        if ($existing) {
            $existing->forceFill(['last_used_at' => now()])->save();

            return ['file' => $existing, 'deduplicated' => true];
        }

        $stored = $this->write($user, $upload, $category, $extension);

        try {
            $file = $this->quota->withReservation($user, $size, fn () => File::create([
                'name' => $this->displayName($name, $upload),
                'path' => $stored['path'],
                'type' => explode('/', $mime)[0],
                'category' => $category,
                'size' => $size,
                'mime_type' => $mime,
                'extension' => $extension,
                'original_name' => mb_substr($upload->getClientOriginalName(), 0, 255),
                'disk' => $stored['disk'],
                'disk_path' => $stored['disk_path'],
                'visibility' => $stored['visibility'],
                'checksum' => $checksum,
                'extraction_status' => $this->initialExtractionStatus($extension, $category),
                'last_used_at' => now(),
                'user_id' => $user->id,
                'created_by' => $user->id,
            ]));
        } catch (Throwable $e) {
            Storage::disk($stored['disk'])->delete($stored['disk_path']);
            throw $e;
        }

        if (TextExtractionService::supports($extension)) {
            $this->extractText($file, $upload->getRealPath());
        }

        return ['file' => $file->refresh(), 'deduplicated' => false];
    }

    /** Swaps the bytes of an existing file (legacy /files/update). Quota is checked on the size difference. */
    public function replace(User $user, File $file, UploadedFile $upload, ?string $name = null): File
    {
        [$extension, $category, $mime] = $this->inspect($upload);
        $size = (int) $upload->getSize();
        $stored = $this->write($user, $upload, $category, $extension);
        $old = ['disk' => $file->disk, 'disk_path' => $file->disk_path];

        try {
            $this->quota->withReservation($user, $size - (int) $file->size, function () use ($file, $upload, $stored, $extension, $category, $mime, $size, $name, $user) {
                $file->forceFill([
                    'name' => $name ? mb_substr($name, 0, 255) : $file->name,
                    'path' => $stored['path'],
                    'type' => explode('/', $mime)[0],
                    'category' => $category,
                    'size' => $size,
                    'mime_type' => $mime,
                    'extension' => $extension,
                    'original_name' => mb_substr($upload->getClientOriginalName(), 0, 255),
                    'disk' => $stored['disk'],
                    'disk_path' => $stored['disk_path'],
                    'visibility' => $stored['visibility'],
                    'checksum' => hash_file('sha256', $upload->getRealPath()),
                    'extraction_status' => $this->initialExtractionStatus($extension, $category),
                    'page_count' => null,
                    'updated_by' => $user->id,
                ])->save();
                $file->textContent()->delete();
            });
        } catch (Throwable $e) {
            Storage::disk($stored['disk'])->delete($stored['disk_path']);
            throw $e;
        }

        if ($old['disk_path']) {
            Storage::disk($old['disk'] ?: $this->disk())->delete($old['disk_path']);
        }
        if (TextExtractionService::supports($extension)) {
            $this->extractText($file, $upload->getRealPath());
        }

        return $file->refresh();
    }

    public function rename(File $file, string $name, User $user): File
    {
        $file->forceFill(['name' => trim($name), 'updated_by' => $user->id])->save();

        return $file;
    }

    /** Soft delete: the bytes stay on disk, but the file leaves the library and frees quota. */
    public function delete(File $file, User $user): void
    {
        $file->forceFill(['is_deleted' => true, 'is_active' => false, 'deleted_by' => $user->id])->save();
        $file->delete();
    }

    public function markUsed(File $file): void
    {
        $file->forceFill(['last_used_at' => now()])->save();
    }

    /** (Re-)extracts document text. Failures are recorded, never thrown. */
    public function extractText(File $file, ?string $localPath = null): ?FileTextContent
    {
        if (! TextExtractionService::supports((string) $file->extension)) {
            return null;
        }

        $temp = null;
        try {
            if (! $localPath) {
                [$localPath, $temp] = $this->localCopy($file);
            }
            $result = $this->extractor->extract($localPath, $file->extension);
            $content = FileTextContent::updateOrCreate(['file_id' => $file->id], [
                'pages' => $result['pages'],
                'outline' => $result['outline'],
                'char_count' => array_sum(array_map(fn ($p) => mb_strlen($p['text']), $result['pages'])),
                'extractor' => $result['extractor'],
                'extracted_at' => now(),
            ]);
            $file->forceFill(['page_count' => count($result['pages']), 'extraction_status' => 'ready'])->save();

            return $content;
        } catch (Throwable $e) {
            Log::warning('File text extraction failed', ['file_id' => $file->id, 'error' => $e->getMessage()]);
            $file->forceFill(['extraction_status' => 'failed'])->save();

            return null;
        } finally {
            if ($temp) {
                @unlink($temp);
            }
        }
    }

    public function disk(): string
    {
        return (string) config('file_library.disk', 'local');
    }

    /**
     * @return array{0: string, 1: string, 2: string} extension, category, mime
     */
    private function inspect(UploadedFile $upload): array
    {
        if (! $upload->isValid()) {
            throw FileLibraryException::invalidFile('The upload did not complete. Please try again.');
        }

        $extension = strtolower($upload->getClientOriginalExtension());
        $allowed = config('file_library.allowed');
        $category = match (true) {
            in_array($extension, $allowed['image'], true) => File::CATEGORY_IMAGE,
            in_array($extension, $allowed['document'], true) => File::CATEGORY_DOCUMENT,
            default => null,
        };

        if ($category === null) {
            $hint = match ($extension) {
                'doc' => ' Please save it as .docx and upload again.',
                'ppt' => ' Please save it as .pptx and upload again.',
                default => '',
            };
            $list = implode(', ', array_map(fn ($e) => '.' . $e, array_merge($allowed['image'], $allowed['document'])));

            throw FileLibraryException::invalidFile(".{$extension} files are not supported.{$hint} Allowed: {$list}.");
        }

        $mime = (string) $upload->getMimeType();
        $accepted = self::MIME_TYPES[$extension] ?? [];
        $matches = collect($accepted)->contains(fn ($m) => str_ends_with($m, '/*') ? str_starts_with($mime, substr($m, 0, -1)) : $m === $mime);
        if (! $matches) {
            throw FileLibraryException::invalidFile("This file doesn't look like a real .{$extension} file.");
        }

        $size = (int) $upload->getSize();
        if ($size <= 0) {
            throw FileLibraryException::invalidFile('The file is empty.');
        }
        $maxMb = (int) config($category === File::CATEGORY_IMAGE ? 'file_library.max_image_mb' : 'file_library.max_document_mb');
        if ($size > $maxMb * 1024 * 1024) {
            throw FileLibraryException::invalidFile(sprintf('This file is %s; %ss can be at most %d MB.', FileLibraryException::formatBytes($size), $category, $maxMb));
        }

        return [$extension, $category, $mime];
    }

    /**
     * @return array{disk: string, disk_path: string, path: ?string, visibility: string}
     */
    private function write(User $user, UploadedFile $upload, string $category, string $extension): array
    {
        $disk = $this->disk();
        $public = $category === File::CATEGORY_IMAGE;
        $relative = sprintf('library/%d/%s/%s', $user->id, $public ? 'images' : 'documents', now()->format('Y/m'));
        $directory = ($public ? 'public/' : 'private/') . $relative;
        $fileName = Str::random(40) . '.' . $extension;

        if (Storage::disk($disk)->putFileAs($directory, $upload, $fileName) === false) {
            throw new \RuntimeException('Could not save the file.');
        }

        return [
            'disk' => $disk,
            'disk_path' => $directory . '/' . $fileName,
            // Same 'storage/...' convention as FileUploadTrait, served by the storage symlink.
            'path' => $public ? 'storage/' . $relative . '/' . $fileName : null,
            'visibility' => $public ? File::VISIBILITY_PUBLIC : File::VISIBILITY_PRIVATE,
        ];
    }

    /**
     * @return array{0: string, 1: ?string} path, temp file to remove afterwards
     */
    private function localCopy(File $file): array
    {
        $storage = Storage::disk($file->disk ?: $this->disk());
        try {
            $path = $storage->path($file->disk_path);
            if (is_file($path)) {
                return [$path, null];
            }
        } catch (Throwable) {
            // Not a local disk; fall through to a temporary copy.
        }

        $temp = tempnam(sys_get_temp_dir(), 'lib');
        file_put_contents($temp, $storage->readStream($file->disk_path));

        return [$temp, $temp];
    }

    private function displayName(?string $name, UploadedFile $upload): string
    {
        $name = trim((string) $name);
        if ($name === '') {
            $name = pathinfo($upload->getClientOriginalName(), PATHINFO_FILENAME) ?: 'Untitled';
        }

        return mb_substr($name, 0, 255);
    }

    private function initialExtractionStatus(string $extension, string $category): string
    {
        return match (true) {
            $category === File::CATEGORY_IMAGE => 'none',
            $extension === 'pdf' => 'client',
            TextExtractionService::supports($extension) => 'none',
            default => 'unsupported',
        };
    }
}
