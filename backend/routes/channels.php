<?php

use Illuminate\Support\Facades\Broadcast;

// Deck (quiz / quest) host channels are registered by DeckServiceProvider.

Broadcast::channel('App.Models.User.{id}', function ($user, $id) {
    return (int) $user->id === (int) $id;
});
