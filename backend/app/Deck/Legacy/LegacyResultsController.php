<?php

namespace App\Deck\Legacy;

use App\Http\Controllers\api\v1\ApiBaseController;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * /api/v1/legacy-results: the owner's results from the previous version of Mindspear
 * (legacy v1 quizzes and quests). Read-only; someone else's or a missing source is a 404.
 */
class LegacyResultsController extends ApiBaseController
{
    public function __construct(private readonly LegacyResults $results) {}

    public function index(Request $request): JsonResponse
    {
        return $this->okResponse(['items' => $this->results->index($request->user())]);
    }

    public function show(Request $request, string $source, int $id): JsonResponse
    {
        $found = $this->results->show($request->user(), $source, $id);

        return $found === null ? $this->notFound() : $this->okResponse($found);
    }

    public function session(Request $request, string $source, int $id, string $session): JsonResponse
    {
        $found = $this->results->session($request->user(), $source, $id, $session);

        return $found === null ? $this->notFound() : $this->okResponse($found);
    }

    public function export(Request $request, string $source, int $id, string $session): StreamedResponse|JsonResponse
    {
        $found = $this->results->session($request->user(), $source, $id, $session);
        if ($found === null) {
            return $this->notFound();
        }

        $name = Str::slug($found['title'] ?: $source) . '-results-' . ($found['session']['id']) . '.csv';
        $rows = $this->results->csv($found);

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

    private function notFound(): JsonResponse
    {
        return $this->notFoundResponse(['code' => 'not_found'], __('Not found.'));
    }
}
