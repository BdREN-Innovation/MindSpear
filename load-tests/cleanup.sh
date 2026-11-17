#!/usr/bin/env sh
# Removes what the load tests left in the database: every deck whose title starts with "k6 "
# (TEST_PREFIX in k6/lib/config.js), including soft-deleted ones, and through the database's
# cascades its sessions, participants and answers. Nothing else is touched.
#
#   load-tests/cleanup.sh                                       # local stack (docker-compose.yml)
#   COMPOSE_FILE=docker-compose.prod.yml load-tests/cleanup.sh  # on a server
set -eu

cd "$(dirname "$0")/.."
compose_file=${COMPOSE_FILE:-docker-compose.yml}

docker compose -f "$compose_file" exec -T backend php artisan tinker --execute='
$decks = App\Models\Deck\Deck::withTrashed()->where("title", "like", "k6 %")->get();
$sessions = App\Models\Deck\DeckSession::whereIn("deck_id", $decks->pluck("id"))->count();
$participants = App\Models\Deck\DeckParticipant::whereIn("deck_session_id", App\Models\Deck\DeckSession::whereIn("deck_id", $decks->pluck("id"))->select("id"))->count();
foreach ($decks as $deck) { $deck->forceDelete(); }
echo "cleanup: removed {$decks->count()} k6 decks, {$sessions} sessions, {$participants} participants (answers with them)", PHP_EOL;
'
