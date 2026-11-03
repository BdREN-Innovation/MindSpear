<?php

use App\Modules\FileLibrary\Http\Controllers\LibraryController;
use Illuminate\Support\Facades\Route;

// Mounted at /api/v1/library by FileLibraryServiceProvider.

Route::middleware('auth:sanctum')->name('library.')->group(function () {
    Route::get('usage', [LibraryController::class, 'usage'])->name('usage');
    Route::get('files', [LibraryController::class, 'index'])->name('files.index');
    Route::post('files', [LibraryController::class, 'store'])->middleware('throttle:library-upload')->name('files.store');
    Route::get('files/{file}', [LibraryController::class, 'show'])->whereNumber('file')->name('files.show');
    Route::patch('files/{file}', [LibraryController::class, 'update'])->whereNumber('file')->name('files.update');
    Route::delete('files/{file}', [LibraryController::class, 'destroy'])->whereNumber('file')->name('files.destroy');
    Route::post('files/{file}/use', [LibraryController::class, 'markUsed'])->whereNumber('file')->name('files.use');
    Route::get('files/{file}/pages', [LibraryController::class, 'pages'])->whereNumber('file')->name('files.pages');
    Route::get('files/{file}/content', [LibraryController::class, 'content'])->whereNumber('file')->name('files.content');
    Route::get('files/{file}/slide-preview', [LibraryController::class, 'slidePreview'])->whereNumber('file')->name('files.slide-preview');
    Route::get('files/{file}/slide-preview/content', [LibraryController::class, 'slidePreviewContent'])->whereNumber('file')->name('files.slide-preview.content');
});
