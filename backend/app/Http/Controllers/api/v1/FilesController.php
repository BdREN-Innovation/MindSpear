<?php

namespace App\Http\Controllers\api\v1;

use App\Http\Requests\File\StoreMultipleRequest;
use App\Http\Requests\File\StoreRequest;
use App\Http\Requests\File\UpdateMultipleRequest;
use App\Http\Requests\File\UpdateRequest;
use App\Models\File;
use App\Modules\FileLibrary\Exceptions\FileLibraryException;
use App\Modules\FileLibrary\Services\FileStorageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Log;

/**
 * Legacy file endpoints used by the question editors for images. Uploads now
 * land in the user's library (My Files) and count toward their quota; every
 * endpoint only sees the signed-in user's own files.
 */
class FilesController extends ApiBaseController
{
    public function __construct(private readonly FileStorageService $storage) {}

    /**
     * Display a listing of the user's files with optional filters.
     */
    public function index(Request $request): JsonResponse
    {
        $query = File::byUser($request->user()->id);

        if ($request->filled('type')) {
            $query->byType($request->type);
        }

        if ($request->filled('category')) {
            $query->byCategory($request->category);
        }

        if ($request->filled('is_active')) {
            $query->where('is_active', $request->boolean('is_active'));
        }

        if ($request->filled('from_date') && $request->filled('to_date')) {
            $query->dateBetween($request->from_date, $request->to_date);
        }

        if ($request->filled('search')) {
            $query->search($request->search);
        }

        $files = $query->latest()->paginate(min(100, (int) $request->get('per_page', 15)));

        return $this->okResponse(['files' => $files], __('Files retrieved with filters.'));
    }

    /**
     * Display the specified file.
     */
    public function show(Request $request, int $id): JsonResponse
    {
        $file = $this->ownedFile($request, $id);

        if (! $file) {
            return $this->notFoundResponse([], __('File not found.'));
        }

        return $this->okResponse(['file' => $file], __('File retrieved successfully.'));
    }

    /**
     * Store a newly uploaded file in the user's library.
     */
    public function store(StoreRequest $request): JsonResponse
    {
        try {
            $result = $this->storage->store($request->user(), $request->file('file'), $request->input('name'));

            return $this->createdResponse(['file' => $result['file']], __('File uploaded successfully.'));
        } catch (FileLibraryException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error('File upload failed', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
                'user_id' => auth()->id(),
            ]);

            return $this->serverErrorResponse([], __('Failed to upload file.'));
        }
    }

    /**
     * Store multiple files in the user's library.
     */
    public function storeMultiple(StoreMultipleRequest $request): JsonResponse
    {
        try {
            $files = [];
            foreach ($request->file('files') as $uploadedFile) {
                $files[] = $this->storage->store($request->user(), $uploadedFile)['file'];
            }

            return $this->createdResponse(['files' => $files], __('Files uploaded successfully.'));
        } catch (FileLibraryException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error('Multiple file upload failed', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
                'user_id' => auth()->id(),
            ]);

            return $this->serverErrorResponse([], __('Failed to upload files.'));
        }
    }

    /**
     * Replace the content and/or rename one of the user's files.
     */
    public function update(UpdateRequest $request, int $id): JsonResponse
    {
        $file = $this->ownedFile($request, $id);

        if (! $file) {
            return $this->notFoundResponse([], __('File not found.'));
        }

        try {
            if ($request->hasFile('file')) {
                $file = $this->storage->replace($request->user(), $file, $request->file('file'), $request->input('name'));
            } elseif ($request->filled('name')) {
                $file = $this->storage->rename($file, $request->input('name'), $request->user());
            }

            return $this->okResponse(['file' => $file], __('File updated successfully.'));
        } catch (FileLibraryException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error('File update failed', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
                'user_id' => auth()->id(),
            ]);

            return $this->serverErrorResponse([], __('Failed to update file.'));
        }
    }

    public function updateMultiple(UpdateMultipleRequest $request): JsonResponse
    {
        $items = $request->validated('files');
        $owned = [];
        foreach ($items as $index => $item) {
            $file = $this->ownedFile($request, (int) $item['id']);
            if (! $file) {
                return $this->notFoundResponse([], __('File not found for ID: :id', ['id' => $item['id']]));
            }
            $owned[$index] = $file;
        }

        try {
            $files = [];
            foreach ($items as $index => $item) {
                $files[] = $this->storage->replace($request->user(), $owned[$index], $request->file("files.{$index}.file"));
            }

            return $this->okResponse(['files' => $files], __('Files updated successfully.'));
        } catch (FileLibraryException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error('Multiple file update failed', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
                'user_id' => auth()->id(),
            ]);

            return $this->serverErrorResponse([], __('Failed to update files.'));
        }
    }

    /**
     * Detach a file from whatever used it. The file itself stays in My Files,
     * because the same image may be used by other questions; it is deleted
     * from the My Files page instead.
     */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $file = $this->ownedFile($request, $id);

        if (! $file) {
            return $this->notFoundResponse([], __('File not found.'));
        }

        return $this->okResponse(['retained' => true], __('Removed. The file is still available in My Files.'));
    }

    /** Other users' files are reported as not found. */
    private function ownedFile(Request $request, int $id): ?File
    {
        $file = File::find($id);

        return $file && Gate::forUser($request->user())->allows('manage', $file) ? $file : null;
    }
}
