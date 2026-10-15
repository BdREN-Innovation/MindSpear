<?php

namespace App\Modules\FileLibrary\Models;

use App\Models\File;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Extracted text of a library document: pages = [{index, label, text, word_count}],
 * outline = [{title, level, page}] (null until read, [] when the document has no headings).
 */
class FileTextContent extends Model
{
    protected $primaryKey = 'file_id';

    public $incrementing = false;

    protected $fillable = ['file_id', 'pages', 'outline', 'char_count', 'extractor', 'extracted_at'];

    protected $casts = [
        'pages' => 'array',
        'outline' => 'array',
        'char_count' => 'integer',
        'extracted_at' => 'datetime',
    ];

    public function file(): BelongsTo
    {
        return $this->belongsTo(File::class);
    }
}
