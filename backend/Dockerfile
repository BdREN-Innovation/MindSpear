FROM php:8.4-cli

RUN apt-get update && apt-get install -y \
    git unzip libpq-dev libzip-dev libicu-dev libpng-dev libxml2-dev \
 && docker-php-ext-install pdo pdo_pgsql pgsql zip intl gd dom xml pcntl \
 && rm -rf /var/lib/apt/lists/* \
 && echo "variables_order = EGPCS" > /usr/local/etc/php/conf.d/env.ini
# My Files uploads: allow documents up to 25 MB (config/file_library.php) plus form overhead
RUN printf "upload_max_filesize = 30M\npost_max_size = 32M\nmemory_limit = 512M\n" > /usr/local/etc/php/conf.d/uploads.ini

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

EXPOSE 8000 8080

CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
