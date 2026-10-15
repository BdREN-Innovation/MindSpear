<?php

namespace App\Modules\FileLibrary\Services;

use GdImage;
use Throwable;

/**
 * Shrinks library images to fit max_image_dimension (1024×1024 by default) before
 * they are hashed, counted and stored, so quota and dedupe see the bytes we keep.
 * Format and aspect ratio are kept; transparency survives; animations are left
 * alone. Anything we can't safely decode (a format this GD build lacks, or more
 * pixels than fit in memory) is stored unchanged, never refused.
 */
class ImageProcessor
{
    /** EXIF orientations that swap width and height. */
    private const TRANSPOSED_ORIENTATIONS = [5, 6, 7, 8];

    /**
     * Returns the file to store: the original path, or a resized temporary copy
     * that the caller must remove (the `temp` key) once it has been written.
     *
     * @return array{path: string, temp: ?string, width: ?int, height: ?int, resized: bool}
     */
    public function prepare(string $path, string $mime): array
    {
        $info = @getimagesize($path);
        if ($info === false || $info[0] <= 0 || $info[1] <= 0) {
            // The MIME check already passed; store it as before, just without dimensions.
            return ['path' => $path, 'temp' => null, 'width' => null, 'height' => null, 'resized' => false];
        }

        $orientation = $mime === 'image/jpeg' ? $this->exifOrientation($path) : 1;
        [$width, $height] = in_array($orientation, self::TRANSPOSED_ORIENTATIONS, true) ? [$info[1], $info[0]] : [$info[0], $info[1]];
        $unchanged = ['path' => $path, 'temp' => null, 'width' => $width, 'height' => $height, 'resized' => false];

        $max = max(1, (int) config('file_library.max_image_dimension', 1024));
        // Decoding needs ~5 bytes per pixel, so huge images (decompression bombs) are kept as uploaded
        // rather than exhausting memory; the per-file MB limit still bounds what they cost.
        $maxPixels = (int) config('file_library.max_image_pixels', 50_000_000);
        if (($width <= $max && $height <= $max)
            || ! $this->canProcess($mime)
            || $width * $height > $maxPixels
            || $this->isAnimated($path, $mime)) {
            return $unchanged;
        }

        $scale = min($max / $width, $max / $height);
        $targetWidth = max(1, (int) round($width * $scale));
        $targetHeight = max(1, (int) round($height * $scale));

        $temp = null;
        try {
            $source = $this->load($path, $mime);
            if (! $source) {
                return $unchanged;
            }
            $source = $this->orient($source, $orientation);
            $resized = $mime === 'image/gif'
                ? $this->resizePalette($source, $targetWidth, $targetHeight)
                : $this->resizeTrueColor($source, $targetWidth, $targetHeight);

            $temp = tempnam(sys_get_temp_dir(), 'img');
            if ($temp === false || ! $this->save($resized, $temp, $mime) || ! filesize($temp)) {
                throw new \RuntimeException('Could not encode the resized image.');
            }

            return ['path' => $temp, 'temp' => $temp, 'width' => $targetWidth, 'height' => $targetHeight, 'resized' => true];
        } catch (Throwable $e) {
            if ($temp) {
                @unlink($temp);
            }
            report($e);

            // Keep the upload working: store the original rather than fail.
            return $unchanged;
        }
    }

    /** Whether this GD build can both decode and encode the format. */
    public function canProcess(string $mime): bool
    {
        if (! extension_loaded('gd')) {
            return false;
        }

        return match ($mime) {
            'image/jpeg' => (imagetypes() & IMG_JPG) !== 0 && function_exists('imagecreatefromjpeg'),
            'image/png' => (imagetypes() & IMG_PNG) !== 0 && function_exists('imagecreatefrompng'),
            'image/gif' => (imagetypes() & IMG_GIF) !== 0 && function_exists('imagecreatefromgif'),
            'image/webp' => (imagetypes() & IMG_WEBP) !== 0 && function_exists('imagecreatefromwebp'),
            default => false,
        };
    }

    /** Animated GIF/WebP/APNG would lose every frame but the first, so they are kept as uploaded. */
    public function isAnimated(string $path, string $mime): bool
    {
        $bytes = @file_get_contents($path);
        if ($bytes === false) {
            return false;
        }

        return match ($mime) {
            'image/gif' => $this->gifHasSeveralFrames($bytes),
            // An acTL chunk before the image data marks an animated PNG.
            'image/png' => ($actl = strpos($bytes, 'acTL')) !== false && $actl < (strpos($bytes, 'IDAT') ?: PHP_INT_MAX),
            'image/webp' => str_contains(substr($bytes, 0, 64), 'ANIM') || str_contains($bytes, 'ANMF'),
            default => false,
        };
    }

    /**
     * Walks the GIF blocks and counts image descriptors. Pattern-matching the bytes misses
     * real animations (and resizing one keeps only its first frame), so the structure is read.
     */
    private function gifHasSeveralFrames(string $bytes): bool
    {
        $length = strlen($bytes);
        if ($length < 13 || ! str_starts_with($bytes, 'GIF')) {
            return false;
        }

        // Header (6) + logical screen descriptor (7) + optional global colour table.
        $offset = 13 + $this->gifColorTableBytes(ord($bytes[10]));
        $frames = 0;
        while ($offset < $length) {
            $block = ord($bytes[$offset]);
            if ($block === 0x2C) {
                if (++$frames > 1) {
                    return true;
                }
                if ($offset + 10 > $length) {
                    break;
                }
                // Image descriptor (10) + optional local colour table + LZW minimum code size (1).
                $offset += 10 + $this->gifColorTableBytes(ord($bytes[$offset + 9])) + 1;
            } elseif ($block === 0x21) {
                // Extension introducer + label.
                $offset += 2;
            } else {
                // Trailer (0x3B), or bytes we don't understand.
                break;
            }

            // Data sub-blocks, ended by a zero-length one.
            while ($offset < $length && ($size = ord($bytes[$offset])) !== 0) {
                $offset += $size + 1;
            }
            $offset++;
        }

        return false;
    }

    private function gifColorTableBytes(int $packed): int
    {
        return ($packed & 0x80) ? 3 * (2 ** (($packed & 0x07) + 1)) : 0;
    }

    /**
     * Without the orientation a resized phone photo is re-encoded sideways for good,
     * so the EXIF tag is read by hand when the exif extension is missing.
     */
    private function exifOrientation(string $path): int
    {
        if ($this->exifAvailable()) {
            $exif = @exif_read_data($path);
            $orientation = is_array($exif) ? (int) ($exif['Orientation'] ?? 1) : 1;
        } else {
            $orientation = $this->readJpegOrientation($path);
        }

        return $orientation >= 1 && $orientation <= 8 ? $orientation : 1;
    }

    protected function exifAvailable(): bool
    {
        return function_exists('exif_read_data');
    }

    /** Finds the Orientation tag (0x0112) in IFD0 of the JPEG's EXIF (APP1) segment; 1 when there is none. */
    private function readJpegOrientation(string $path): int
    {
        // EXIF lives in the header segments, each at most 64 KB, before the image data.
        $bytes = (string) @file_get_contents($path, false, null, 0, 256 * 1024);
        $length = strlen($bytes);
        if (! str_starts_with($bytes, "\xFF\xD8")) {
            return 1;
        }

        $offset = 2;
        while ($offset + 4 <= $length && $bytes[$offset] === "\xFF") {
            $marker = ord($bytes[$offset + 1]);
            if ($marker === 0xFF) {
                // Fill byte before a marker.
                $offset++;

                continue;
            }
            if ($marker === 0xDA || $marker === 0xD9) {
                // Start of scan or end of image: no EXIF before the image data.
                break;
            }
            $segment = unpack('n', $bytes, $offset + 2)[1];
            if ($marker === 0xE1 && substr($bytes, $offset + 4, 6) === "Exif\0\0") {
                return $this->tiffOrientation(substr($bytes, $offset + 10, max(0, $segment - 8)));
            }
            $offset += 2 + $segment;
        }

        return 1;
    }

    private function tiffOrientation(string $tiff): int
    {
        [$short, $long] = match (substr($tiff, 0, 2)) {
            'II' => ['v', 'V'],
            'MM' => ['n', 'N'],
            default => [null, null],
        };
        $length = strlen($tiff);
        if ($short === null || $length < 8) {
            return 1;
        }

        $ifd = unpack($long, $tiff, 4)[1];
        if ($ifd + 2 > $length) {
            return 1;
        }
        $entries = unpack($short, $tiff, $ifd)[1];
        for ($i = 0; $i < $entries; $i++) {
            // Each entry: tag (2), type (2), count (4), value (4; a SHORT sits in its first 2 bytes).
            $entry = $ifd + 2 + $i * 12;
            if ($entry + 12 > $length) {
                break;
            }
            if (unpack($short, $tiff, $entry)[1] === 0x0112) {
                return (int) unpack($short, $tiff, $entry + 8)[1];
            }
        }

        return 1;
    }

    private function load(string $path, string $mime): ?GdImage
    {
        $image = match ($mime) {
            'image/jpeg' => @imagecreatefromjpeg($path),
            'image/png' => @imagecreatefrompng($path),
            'image/gif' => @imagecreatefromgif($path),
            'image/webp' => @imagecreatefromwebp($path),
            default => false,
        };

        return $image instanceof GdImage ? $image : null;
    }

    /** Applies the EXIF orientation, because re-encoding drops the tag that told browsers to rotate. */
    private function orient(GdImage $image, int $orientation): GdImage
    {
        // imagerotate() turns counter-clockwise; mirrored orientations flip after rotating.
        $angle = match ($orientation) {
            3, 4 => 180,
            5, 6 => 270,
            7, 8 => 90,
            default => 0,
        };
        if ($angle !== 0) {
            $rotated = imagerotate($image, $angle, 0);
            if ($rotated instanceof GdImage) {
                $image = $rotated;
            }
        }
        if (in_array($orientation, [2, 4, 5, 7], true)) {
            imageflip($image, IMG_FLIP_HORIZONTAL);
        }

        return $image;
    }

    /** JPEG, PNG and WebP: smooth resampling into a true-colour canvas that keeps the alpha channel. */
    private function resizeTrueColor(GdImage $source, int $width, int $height): GdImage
    {
        if (! imageistruecolor($source)) {
            imagepalettetotruecolor($source);
        }

        $target = imagecreatetruecolor($width, $height);
        imagealphablending($target, false);
        imagesavealpha($target, true);
        imagefilledrectangle($target, 0, 0, $width - 1, $height - 1, imagecolorallocatealpha($target, 0, 0, 0, 127));
        imagecopyresampled($target, $source, 0, 0, 0, 0, $width, $height, imagesx($source), imagesy($source));

        return $target;
    }

    /**
     * GIF: palette in, palette out. Nearest-neighbour copying keeps the single
     * transparent colour exact, where resampling would blend it into the edges.
     */
    private function resizePalette(GdImage $source, int $width, int $height): GdImage
    {
        if (imageistruecolor($source)) {
            return $this->resizeTrueColor($source, $width, $height);
        }

        $target = imagecreate($width, $height);
        imagepalettecopy($target, $source);
        $transparent = imagecolortransparent($source);
        if ($transparent >= 0 && $transparent < imagecolorstotal($source)) {
            imagefilledrectangle($target, 0, 0, $width - 1, $height - 1, $transparent);
            imagecolortransparent($target, $transparent);
        }
        imagecopyresized($target, $source, 0, 0, 0, 0, $width, $height, imagesx($source), imagesy($source));

        return $target;
    }

    private function save(GdImage $image, string $path, string $mime): bool
    {
        return match ($mime) {
            'image/jpeg' => imagejpeg($image, $path, 85),
            'image/png' => imagepng($image, $path, 6),
            'image/gif' => imagegif($image, $path),
            'image/webp' => imagewebp($image, $path, 85),
            default => false,
        };
    }
}
