<?php

namespace App\Modules\FileLibrary\Http\Controllers;

use App\Http\Controllers\api\v1\ApiBaseController;
use App\Models\File;
use App\Modules\FileLibrary\Exceptions\FileLibraryException;
use App\Modules\FileLibrary\Http\Requests\RenameRequest;
use App\Modules\FileLibrary\Http\Requests\UploadRequest;
use App\Modules\FileLibrary\Http\Resources\FilePresenter;
use App\Modules\FileLibrary\Services\FileReferenceService;
use App\Modules\FileLibrary\Services\FileStorageService;
use App\Modules\FileLibrary\Services\QuotaService;
use App\Modules\FileLibrary\Services\SlidePreviewService;
use App\Modules\FileLibrary\Services\TextExtractionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/** My Files: the signed-in user's own images, videos and documents. Other users' files look like 404s. */
class LibraryController extends ApiBaseController
{
    public function __construct(
        private readonly FileStorageService $storage,
        private readonly QuotaService $quota,
        private readonly FileReferenceService $references,
        private readonly SlidePreviewService $slides,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $params = $request->validate([
            'search' => 'nullable|string|max:100',
            'category' => 'nullable|in:image,document,video',
            'sort' => 'nullable|in:newest,oldest,name,size,last_used',
            'per_page' => 'nullable|integer|min:1|max:100',
        ]);

        $query = File::where('user_id', $request->user()->id);
        if (! empty($params['category'])) {
            $query->byCategory($params['category']);
        }
        if (! empty($params['search'])) {
            $query->search($params['search']);
        }

        match ($params['sort'] ?? 'newest') {
            'oldest' => $query->orderBy('created_at')->orderBy('id'),
            'name' => $query->orderByRaw('LOWER(name)')->orderBy('id'),
            'size' => $query->orderByDesc('size')->orderByDesc('id'),
            'last_used' => $query->orderByRaw('COALESCE(last_used_at, created_at) DESC')->orderByDesc('id'),
            default => $query->orderByDesc('created_at')->orderByDesc('id'),
        };

        $page = $query->paginate((int) ($params['per_page'] ?? 24));

        return $this->okResponse([
            'files' => array_map([FilePresenter::class, 'file'], $page->items()),
            'pagination' => [
                'currentPage' => $page->currentPage(),
                'lastPage' => $page->lastPage(),
                'perPage' => $page->perPage(),
                'total' => $page->total(),
            ],
            'usage' => $this->quota->usage($request->user()),
        ], __('Files retrieved.'));
    }

    public function usage(Request $request): JsonResponse
    {
        return $this->okResponse(['usage' => $this->quota->usage($request->user())]);
    }

    public function store(UploadRequest $request): JsonResponse
    {
        $result = $this->storage->store($request->user(), $request->file('file'), $request->input('name'));

        return $this->createdResponse([
            'file' => FilePresenter::file($result['file']),
            'deduplicated' => $result['deduplicated'],
            'usage' => $this->quota->usage($request->user()),
        ], $result['deduplicated'] ? __('This file is already in My Files, so we reused it.') : __('File uploaded.'));
    }

    public function show(Request $request, int $file): JsonResponse
    {
        return $this->okResponse(['file' => FilePresenter::file($this->ownedFile($request, $file))]);
    }

    public function update(RenameRequest $request, int $file): JsonResponse
    {
        $renamed = $this->storage->rename($this->ownedFile($request, $file), $request->validated('name'), $request->user());

        return $this->okResponse(['file' => FilePresenter::file($renamed)], __('File renamed.'));
    }

    public function destroy(Request $request, int $file): JsonResponse
    {
        $owned = $this->ownedFile($request, $file);

        if (! $request->boolean('force')) {
            $references = $this->references->references($owned);
            if ($references) {
                throw FileLibraryException::inUse($references, (string) $owned->category);
            }
        }

        $this->storage->delete($owned, $request->user());

        return $this->okResponse(['usage' => $this->quota->usage($request->user())], __('File deleted.'));
    }

    public function markUsed(Request $request, int $file): JsonResponse
    {
        $owned = $this->ownedFile($request, $file);
        $this->storage->markUsed($owned);

        return $this->okResponse(['file' => FilePresenter::file($owned)]);
    }

    /**
     * Text per page/slide/section, plus the outline (chapters) when the document has headings.
     * PDFs are read in the browser (pages and bookmarks), so only their kind is returned.
     */
    public function pages(Request $request, int $file): JsonResponse
    {
        $owned = $this->ownedFile($request, $file);

        if ($owned->isImage() || $owned->isVideo()) {
            throw FileLibraryException::invalidFile(($owned->isImage() ? 'Images' : 'Videos') . ' have no text to generate questions from.');
        }
        if ($owned->extension === 'pdf') {
            return $this->okResponse(['kind' => 'pdf', 'pageCount' => $owned->page_count, 'pages' => [], 'outline' => []]);
        }
        if (! TextExtractionService::supports((string) $owned->extension)) {
            throw FileLibraryException::invalidFile('Text can\'t be read from this kind of file.');
        }

        $content = $owned->textContent;
        // Files read before outlines existed have outline = null: read them again once.
        if (! $content || $content->outline === null || $request->boolean('refresh')) {
            $content = $this->storage->extractText($owned) ?? $content;
        }
        if (! $content || ! $content->pages) {
            throw FileLibraryException::invalidFile('We couldn\'t find any text in this file. If it only contains pictures, try a PDF or a text-based copy.');
        }

        return $this->okResponse([
            'kind' => 'text',
            'pageCount' => count($content->pages),
            'pages' => $content->pages,
            'outline' => $content->outline ?? [],
        ]);
    }

    /** The file's bytes for the owner (private documents, and PDFs for pdfjs without CORS trouble). */
    public function content(Request $request, int $file): StreamedResponse
    {
        $owned = $this->ownedFile($request, $file);
        $disk = Storage::disk($owned->disk ?: $this->storage->disk());
        if (! $owned->disk_path || ! $disk->exists($owned->disk_path)) {
            throw FileLibraryException::notFound('The file is missing from storage.');
        }

        $downloadName = $owned->name . ($owned->extension && ! str_ends_with(strtolower($owned->name), '.' . $owned->extension) ? '.' . $owned->extension : '');
        $headers = [
            'Content-Type' => $owned->mime_type ?: 'application/octet-stream',
            'Cache-Control' => 'private, max-age=300',
            'X-Content-Type-Options' => 'nosniff',
        ];

        return $request->boolean('download')
            ? $disk->download($owned->disk_path, $downloadName, $headers)
            : $disk->response($owned->disk_path, $downloadName, $headers);
    }

    /** Whether a PPTX's slides can be shown yet: ready, processing or failed. Asks for them if nothing is under way. */
    public function slidePreview(Request $request, int $file): JsonResponse
    {
        $owned = $this->ownedFile($request, $file);
        if (! SlidePreviewService::supports($owned)) {
            throw FileLibraryException::invalidFile('Only PowerPoint files have a slide preview.');
        }

        return $this->okResponse(['status' => $this->slides->status($owned)]);
    }

    /** The slides of a PPTX as a PDF, for pdfjs. */
    public function slidePreviewContent(Request $request, int $file): StreamedResponse
    {
        $owned = $this->ownedFile($request, $file);
        if (! SlidePreviewService::supports($owned) || ! $this->slides->exists($owned)) {
            throw FileLibraryException::notFound('The slide preview isn\'t ready.');
        }

        return Storage::disk($this->slides->disk($owned))->response($this->slides->path($owned), 'slides.pdf', [
            'Content-Type' => 'application/pdf',
            'Cache-Control' => 'private, max-age=300',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    private function ownedFile(Request $request, int $id): File
    {
        $file = File::find($id);
        if (! $file || Gate::forUser($request->user())->denies('manage', $file)) {
            throw FileLibraryException::notFound();
        }

        return $file;
    }
}
