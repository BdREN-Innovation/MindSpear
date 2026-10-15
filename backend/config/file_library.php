<?php

/*
|--------------------------------------------------------------------------
| My Files (per-user file library)
|--------------------------------------------------------------------------
|
| Every image and document a user uploads is kept in their library and
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

    // Extensions per category. SVG is left out on purpose: it can carry scripts.
    'allowed' => [
        'image' => ['jpg', 'jpeg', 'png', 'gif', 'webp'],
        'document' => ['pdf', 'docx', 'pptx', 'txt'],
    ],

    // Uncompressed size we are willing to read from one entry of a docx/pptx (zip-bomb guard).
    'max_extract_bytes' => 20 * 1024 * 1024,

    // Characters of extracted text kept per file.
    'max_text_chars' => 500_000,

    // Words per "section" when a document has no page or heading breaks.
    'section_words' => 600,

];
