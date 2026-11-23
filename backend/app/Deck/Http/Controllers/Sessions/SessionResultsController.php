<?php

namespace App\Deck\Http\Controllers\Sessions;

use App\Deck\Http\Controllers\DeckController;
use App\Deck\Http\Resources\DeckPresenter;
use App\Deck\Results\SessionResultsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Past sessions of a deck and their results, for the deck owner who hosted
 * them (Sanctum; anyone else gets 404, like every deck route).
 *
 *   GET /quizzes/{deck}/sessions                → {deck, sessions, legacy}
 *   GET /quiz-sessions/{session}/results        → SessionResultsService::results()
 *   GET /quiz-sessions/{session}/results/export → CSV
 */
class SessionResultsController extends DeckController
{
    public function __construct(private readonly SessionResultsService $results) {}

    public function index(Request $request, string $deck): JsonResponse
    {
        $model = $this->ownedDeck($request, $deck);

        return $this->okResponse([
            'deck' => DeckPresenter::summary($model),
            'sessions' => $this->results->sessions($model, (int) $request->user()->id),
            'legacy' => $this->results->legacySessions($model, $request->user()),
        ]);
    }

    public function show(Request $request, string $session): JsonResponse
    {
        return $this->okResponse($this->results->results($this->ownedSession($request, $session)));
    }

    public function export(Request $request, string $session): StreamedResponse
    {
        $model = $this->ownedSession($request, $session);
        $name = Str::slug($model->deck?->title ?: $this->product($request)) . '-session-' . $model->id . '.csv';
        $rows = $this->results->csv($model);

        return response()->streamDownload(function () use ($rows) {
            $out = fopen('php://output', 'w');
            fwrite($out, "\xEF\xBB\xBF"); // UTF-8 BOM, so Excel shows Bangla and other scripts correctly
            foreach ($rows as $row) {
                fputcsv($out, array_map(fn ($cell) => self::safeCell($cell), $row));
            }
            fclose($out);
        }, $name, ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    /** Keeps spreadsheet apps from running a participant's typed text as a formula. */
    private static function safeCell(mixed $cell): string
    {
        $cell = (string) $cell;

        return $cell !== '' && in_array($cell[0], ['=', '+', '-', '@', "\t", "\r"], true) ? "'" . $cell : $cell;
    }
}
