<?php

namespace App\Modules\FileLibrary\Jobs;

use App\Models\File;
use App\Modules\FileLibrary\Services\FileStorageService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/** Renders a PPTX's slides for the page picker (see SlidePreviewService). */
class GenerateSlidePreview implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    /** Longer than the LibreOffice timeout, so a stuck conversion is recorded as failed. */
    public int $timeout = 180;

    public function __construct(public readonly int $fileId)
    {
        $this->onQueue('documents');
    }

    public function handle(FileStorageService $storage): void
    {
        $file = File::find($this->fileId);
        if ($file) {
            $storage->renderSlidePreview($file);
        }
    }
}
