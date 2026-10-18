<?php

namespace App\Http\Controllers\api\v1\Quiz;

use App\Http\Controllers\api\v1\ApiBaseController;
use App\Models\Quiz\QuizParticipant;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class QuizParticipantController extends ApiBaseController
{
    /**
     * Display a listing of the quiz participants.
     */
    public function index(Request $request): JsonResponse
    {
        // Only participants of the caller's own quizzes: unfiltered, this listed every user's
        // participants (names and scores) in any quiz report.
        $quizParticipants = QuizParticipant::with(['quiz', 'user'])
            ->whereHas('quiz', fn ($query) => $query->where('user_id', auth()->id()));

        if ($request->has('quiz_id')) {
            $quizParticipants = $quizParticipants->where('quiz_id', $request->input('quiz_id'));
        }

        if ($request->has('user_id')) {
            $quizParticipants = $quizParticipants->where('user_id', $request->input('user_id'));
        }

        if ($request->has('status')) {
            $quizParticipants = $quizParticipants->where('status', $request->input('status'));
        }

        if ($request->has('is_anonymous')) {
            $quizParticipants = $quizParticipants->where('is_anonymous', $request->input('is_anonymous'));
        }

        if ($request->has('start_time')) {
            $quizParticipants = $quizParticipants->where('start_time', '>=', $request->input('start_time'));
        }

        if ($request->has('end_time')) {
            $quizParticipants = $quizParticipants->where('end_time', '<=', $request->input('end_time'));
        }

        if ($request->has('score')) {
            $quizParticipants = $quizParticipants->where('score', '>=', $request->input('score'));
        }

        // You might want to add pagination here
        $quizParticipants = $quizParticipants->paginate($request->input('per_page', 10));

        // Return the paginated results
        return $this->okResponse(['quiz_participants' => $quizParticipants], __('Quiz Participants fetched successfully.'));
    }

    /**
     * Show the details of a specific quiz participant.
     */
    public function show($id): JsonResponse
    {
        $quizParticipant = QuizParticipant::with(['quiz', 'user'])->find($id);

        if (! $quizParticipant) {
            return $this->notFoundResponse([], __('Quiz Participant not found.'));
        }

        return $this->okResponse(['quiz_participant' => $quizParticipant], __('Quiz Participant fetched successfully.'));
    }

    /**
     * Delete a specific quiz participant.
     */
    public function destroy($id)
    {
        // Implement the logic to delete a specific quiz participant by ID
    }
}
