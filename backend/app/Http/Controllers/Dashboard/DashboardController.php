<?php

namespace App\Http\Controllers\Dashboard;

use App\Deck\Authoring\DeckStatistics;
use App\Http\Controllers\api\v1\ApiBaseController;
use App\Models\Deck\Deck;
use App\Models\Quiz\BankQuestion;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DashboardController extends ApiBaseController
{
    public function __construct(private readonly DeckStatistics $decks) {}

    /**
     * GET /dashboard-statistics/dashboard → {quizzes, quests: DeckStatistics::forOwner(), question_bank_count}.
     */
    public function dashboard(Request $request): JsonResponse
    {
        $user = $request->user();

        return $this->okResponse([
            'quizzes' => $this->decks->forOwner($user, Deck::PRODUCT_QUIZ),
            'quests' => $this->decks->forOwner($user, Deck::PRODUCT_QUEST),
            'question_bank_count' => BankQuestion::query()->where('owner_id', $user->id)->count(),
        ], __('Dashboard statistics retrieved successfully.'));
    }
}
