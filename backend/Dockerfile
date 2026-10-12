FROM php:8.4-cli

RUN apt-get update && apt-get install -y \
    git unzip libpq-dev libzip-dev libicu-dev libpng-dev libxml2-dev \
 && docker-php-ext-install pdo pdo_pgsql pgsql zip intl gd dom xml pcntl \
 && rm -rf /var/lib/apt/lists/* \
 && echo "variables_order = EGPCS" > /usr/local/etc/php/conf.d/env.ini

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app

COPY composer.json composer.lock ./
RUN composer install --no-interaction --no-scripts --no-autoloader --prefer-dist

COPY . .
RUN composer dump-autoload --optimize \
 && mkdir -p storage/framework/{sessions,views,cache/data} bootstrap/cache \
 && chmod -R 775 storage bootstrap/cache

EXPOSE 8000 8080

CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
