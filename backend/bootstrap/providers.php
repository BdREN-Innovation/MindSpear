<?php

return [
    App\Providers\AppServiceProvider::class,
    App\Providers\EventServiceProvider::class,
    App\Providers\Filament\AdminPanelProvider::class,
    App\Modules\FunGame\Providers\FunGameServiceProvider::class,
    App\Modules\FileLibrary\Providers\FileLibraryServiceProvider::class,
    App\Providers\DeckServiceProvider::class,
];
