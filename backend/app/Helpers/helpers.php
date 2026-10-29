<?php

if (! function_exists('getStorageDriver')) {
    /**
     * The default filesystem disk (FileUploadTrait), e.g. 'public' or 's3'.
     */
    function getStorageDriver(): string
    {
        return config('filesystems.default', 'local');
    }
}

if (! function_exists('frontend_url')) {
    /**
     * An absolute URL on the frontend app (config app.frontend_url).
     */
    function frontend_url(string $path = ''): string
    {
        return rtrim(config('app.frontend_url'), '/') . '/' . ltrim($path, '/');
    }
}
