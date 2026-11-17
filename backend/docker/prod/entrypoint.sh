#!/bin/sh
# Runs before every process in the backend image. Only the service with RUN_MIGRATIONS=true
# (docker-compose.prod.yml: backend) touches the database here.
set -e

php artisan config:cache

if [ "$RUN_MIGRATIONS" = "true" ]; then
    php artisan migrate --force

    # Not DatabaseSeeder: it creates demo logins with the password "password".
    if [ "$(php artisan tinker --execute='echo App\Models\Preference::count();')" = "0" ]; then
        php artisan db:seed --class=PreferencesTableSeeder --force
    fi

    # Creates the /super-admin login if it doesn't exist; an existing password is left alone.
    if [ -n "$SUPER_ADMIN_EMAIL" ] && [ -n "$SUPER_ADMIN_PASSWORD" ]; then
        php artisan db:seed --class=SuperAdminSeeder --force
    fi
fi

exec "$@"
