<?php

namespace App\Modules\FileLibrary\Services;

use App\Models\File;
use App\Modules\FileLibrary\Jobs\GenerateSlidePreview;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Http\File as LocalFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/**
 * Renders a PPTX to a PDF with LibreOffice, so the browser can show the real
 * slides: pdfjs draws the thumbnails, as for any PDF. The PDF is a derived copy,
 * not a row in `files`, so it doesn't count toward the quota. It is named after
 * the file's checksum, so changed bytes never show an old preview.
 *
 * Conversion takes seconds and runs on its own queue ("documents"): on the
 * default queue it would hold up live session broadcasts.
 */
class SlidePreviewService
{
    public const READY = 'ready';

    public const PROCESSING = 'processing';

    public const FAILED = 'failed';

    /** A job that never ran (no worker) is requested again after this long. */
    private const PROCESSING_MINUTES = 15;

    /** A file LibreOffice can't convert is not tried again for this long. */
    private const FAILED_MINUTES = 60;

    /**
     * LibreOffice opens files users uploaded: nothing they link to may be fetched
     * from the network or this machine, and no macro may run.
     */
    private const PROFILE = <<<'XML'
        <?xml version="1.0" encoding="UTF-8"?>
        <oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableActiveContent" oor:op="fuse"><value>true</value></prop></item>
        <item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item>
        <item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
        </oor:items>
        XML;

    public static function supports(File $file): bool
    {
        return strtolower((string) $file->extension) === 'pptx';
    }

    public function disk(File $file): string
    {
        return $file->disk ?: (string) config('file_library.disk', 'local');
    }

    public function path(File $file): string
    {
        return sprintf('private/library/%d/previews/%s.pdf', $file->user_id, $file->checksum ?: 'file-' . $file->id);
    }

    public function exists(File $file): bool
    {
        return Storage::disk($this->disk($file))->exists($this->path($file));
    }

    /** Where the preview stands, asking for it first if nothing is under way. */
    public function status(File $file): string
    {
        $this->request($file);

        return $this->exists($file) ? self::READY : (string) Cache::get($this->stateKey($file), self::FAILED);
    }

    /** Queues the conversion unless it exists, is under way or recently failed. Never throws: uploads don't depend on it. */
    public function request(File $file): void
    {
        if (! self::supports($file) || $this->exists($file)) {
            return;
        }
        $key = $this->stateKey($file);
        if (! Cache::add($key, self::PROCESSING, now()->addMinutes(self::PROCESSING_MINUTES))) {
            return;
        }
        try {
            GenerateSlidePreview::dispatch($file->id);
        } catch (Throwable $e) {
            Log::warning('Slide preview could not be queued', ['file_id' => $file->id, 'error' => $e->getMessage()]);
            Cache::forget($key);
        }
    }

    /** Runs LibreOffice on the PPTX at $localPath and stores the PDF. */
    public function convert(File $file, string $localPath): void
    {
        $directory = sys_get_temp_dir() . '/slides-' . Str::random(16);
        $filesystem = new Filesystem;
        $filesystem->ensureDirectoryExists($directory . '/profile/user');

        try {
            $filesystem->put($directory . '/profile/user/registrymodifications.xcu', self::PROFILE);
            // LibreOffice picks its import filter by extension, and the name of the output follows the input's.
            $filesystem->copy($localPath, $directory . '/slides.pptx');

            $result = Process::timeout((int) config('file_library.slide_preview_timeout', 120))
                ->env(['HOME' => $directory])
                ->path($directory)
                ->run([
                    (string) config('file_library.soffice_binary', 'soffice'),
                    '-env:UserInstallation=file://' . $directory . '/profile',
                    '--headless',
                    '--norestore',
                    '--nolockcheck',
                    '--convert-to',
                    // Hidden slides too: PDF page N must stay slide N.
                    'pdf:impress_pdf_Export:{"ExportHiddenSlides":{"type":"boolean","value":"true"}}',
                    '--outdir',
                    $directory,
                    $directory . '/slides.pptx',
                ]);

            $pdf = $directory . '/slides.pdf';
            if (! $result->successful() || ! is_file($pdf)) {
                throw new RuntimeException(trim($result->errorOutput()) ?: 'LibreOffice produced no PDF.');
            }

            $target = $this->path($file);
            Storage::disk($this->disk($file))->putFileAs(dirname($target), new LocalFile($pdf), basename($target));
            Cache::forget($this->stateKey($file));
        } finally {
            $filesystem->deleteDirectory($directory);
        }
    }

    public function markFailed(File $file): void
    {
        Cache::put($this->stateKey($file), self::FAILED, now()->addMinutes(self::FAILED_MINUTES));
    }

    public function delete(string $disk, string $path): void
    {
        Storage::disk($disk)->delete($path);
    }

    private function stateKey(File $file): string
    {
        return 'file-library:slide-preview:' . $file->id . ':' . ($file->checksum ?: 'none');
    }
}
