FROM php:8.4-cli

# GD needs JPEG and WebP so My Files can shrink photos (ImageProcessor), and exif
# so phone photos are turned upright before they are re-encoded.
RUN apt-get update && apt-get install -y \
    git unzip libpq-dev libzip-dev libicu-dev libpng-dev libjpeg62-turbo-dev libwebp-dev libxml2-dev \
 && docker-php-ext-configure gd --with-jpeg --with-webp \
 && docker-php-ext-install pdo pdo_pgsql pgsql zip intl gd exif dom xml pcntl \
 && rm -rf /var/lib/apt/lists/* \
 && echo "variables_order = EGPCS" > /usr/local/etc/php/conf.d/env.ini
# My Files uploads: allow videos up to 50 MB (config/file_library.php) plus form overhead
RUN printf "upload_max_filesize = 60M\npost_max_size = 64M\nmemory_limit = 512M\n" > /usr/local/etc/php/conf.d/uploads.ini

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app

COPY composer.json composer.lock ./
RUN composer install --no-interaction --no-scripts --no-autoloader --prefer-dist

COPY . .
# Create Laravel runtime directories before Composer scripts run
RUN mkdir -p storage/framework/sessions \
    storage/framework/views \
    storage/framework/cache/data \
    bootstrap/cache \
    && chmod -R 775 storage bootstrap/cache

# Generate optimized autoload files and discover packages
RUN composer dump-autoload --optimize

# Only the documents-queue service builds with this (docker-compose.yml): LibreOffice is large,
# and renders PPTX slides for the page picker. Noto covers Bangla; Liberation and Carlito stand
# in for Arial, Times and Calibri with the same metrics, so slides keep their layout.
ARG WITH_LIBREOFFICE=0
RUN if [ "$WITH_LIBREOFFICE" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends \
        libreoffice-impress fonts-noto-core fonts-liberation fonts-crosextra-carlito \
      && rm -rf /var/lib/apt/lists/*; \
    fi

EXPOSE 8000 8080

CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
