<?php

/*
|--------------------------------------------------------------------------
| My Files (per-user file library)
|--------------------------------------------------------------------------
|
| Every image, video and document a user uploads is kept in their library and
| counts toward their storage quota. Super Admin can override the quota per
| user (users.storage_quota_bytes); null means the default below.
|
*/

return [

    'disk' => env('FILE_LIBRARY_DISK', 'local'),

    'default_quota_mb' => (int) env('FILE_LIBRARY_DEFAULT_QUOTA_MB', 100),

    // Per-file limits, in MB. Keep below PHP's upload_max_filesize (backend/Dockerfile).
    'max_image_mb' => (int) env('FILE_LIBRARY_MAX_IMAGE_MB', 10),
    'max_document_mb' => (int) env('FILE_LIBRARY_MAX_DOCUMENT_MB', 25),
    'max_video_mb' => (int) env('FILE_LIBRARY_MAX_VIDEO_MB', 50),

    // New bytes one user may upload per 24 hours, files deleted since included (or their quota, if larger).
    // Deleting frees quota but keeps the bytes on disk, so this stops upload-delete loops filling the disk.
    'max_daily_upload_mb' => (int) env('FILE_LIBRARY_MAX_DAILY_UPLOAD_MB', 1024),

    // Images larger than this (either side, in px) are downscaled to fit before they are stored.
    'max_image_dimension' => (int) env('FILE_LIBRARY_MAX_IMAGE_DIMENSION', 1024),

    // Images over this many pixels are stored as uploaded, not resized: decoding them could exhaust PHP's memory.
    'max_image_pixels' => (int) env('FILE_LIBRARY_MAX_IMAGE_PIXELS', 50_000_000),

    // Extensions per category. SVG is left out on purpose: it can carry scripts.
    'allowed' => [
        'image' => ['jpg', 'jpeg', 'png', 'gif', 'webp'],
        'document' => ['pdf', 'docx', 'pptx', 'txt'],
        // Browser-playable only: nothing is transcoded.
        'video' => ['mp4'],
    ],

    // Uncompressed size we are willing to read from one entry of a docx/pptx (zip-bomb guard).
    'max_extract_bytes' => 20 * 1024 * 1024,

    // Characters of extracted text kept per file.
    'max_text_chars' => 500_000,

    // Words per "section" when a document has no page or heading breaks.
    'section_words' => 600,

];
