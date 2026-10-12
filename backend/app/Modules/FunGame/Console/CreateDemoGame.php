<?php

namespace App\Modules\FunGame\Console;

use App\Models\User;
use App\Modules\FunGame\Models\FunGame;
use App\Modules\FunGame\Models\FunGameQuestion;
use App\Modules\FunGame\Services\SessionEngine;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Creates a published sample game for a host and opens a session, so the
 * participant screens can be tried before the host screens exist.
 */
class CreateDemoGame extends Command
{
    protected $signature = 'fun-games:demo
        {email : Email of the host user who will own the game}
        {--mode=per_question : Timer mode: per_question or total}
        {--seconds= : Seconds per question (per_question) or for the whole quiz (total)}
        {--start-in=60 : Start automatically after this many seconds (0 = start now)}
        {--scoring=marks : Scoring: marks or speed}';

    protected $description = 'Create a sample Fun Games game and session for testing';

    private const QUESTIONS = [
        ['What does CPU stand for?', ['Central Processing Unit', 'Computer Personal Unit', 'Central Program Utility', 'Core Processing Unit'], 0],
        ['Which planet is known as the Red Planet?', ['Venus', 'Mars', 'Jupiter', 'Mercury'], 1],
        ['How many bits are in a byte?', ['4', '16', '8', '32'], 2],
        ['Which protocol secures web traffic?', ['FTP', 'HTTP', 'SMTP', 'HTTPS'], 3],
        ['What is 12 × 12?', ['144', '124', '132', '154'], 0],
    ];

    public function handle(SessionEngine $engine): int
    {
        $user = User::where('email', $this->argument('email'))->first();
        if (! $user) {
            $this->error('No user with that email.');

            return self::FAILURE;
        }
        $mode = $this->option('mode') === 'total' ? FunGame::TIMER_TOTAL : FunGame::TIMER_PER_QUESTION;
        $seconds = (int) ($this->option('seconds') ?: ($mode === FunGame::TIMER_TOTAL ? 180 : 20));
        $startIn = max(0, (int) $this->option('start-in'));

        $session = DB::transaction(function () use ($user, $mode, $seconds, $startIn, $engine) {
            $game = FunGame::create([
                'user_id' => $user->id,
                'title' => $mode === FunGame::TIMER_TOTAL ? 'Demo — Total timer' : 'Demo — Per-question timer',
                'description' => 'Sample game created with fun-games:demo.',
                'instructions' => 'Answer as many as you can. Correct: +2, wrong: −0.5.',
                'status' => FunGame::STATUS_PUBLISHED,
                'timer_mode' => $mode,
                'total_seconds' => $mode === FunGame::TIMER_TOTAL ? $seconds : 1200,
                'seconds_per_question' => $mode === FunGame::TIMER_PER_QUESTION ? $seconds : 30,
                'scoring_mode' => $this->option('scoring') === 'speed' ? FunGame::SCORING_SPEED : FunGame::SCORING_MARKS,
                'shuffle_questions' => true,
            ]);
            foreach (self::QUESTIONS as $i => [$text, $options, $answer]) {
                FunGameQuestion::create([
                    'fun_game_id' => $game->id,
                    'position' => $i + 1,
                    'text' => $text,
                    'options' => collect($options)->map(fn ($o, $j) => ['id' => 'o' . ($j + 1), 'text' => $o])->all(),
                    'correct_option_id' => 'o' . ($answer + 1),
                    'marks' => 2,
                    'negative_marks' => 0.5,
                ]);
            }

            return $engine->createSession($game, $startIn > 0 ? now()->addSeconds($startIn) : null);
        });

        if ($startIn === 0) {
            $session = $engine->start($session);
        }

        $this->info('Join code: ' . $session->join_code);
        $this->line('Join URL:  ' . frontend_url('/attempt/fun-games/' . $session->join_code));
        $this->line($startIn > 0
            ? "Starts in {$startIn}s (needs `php artisan fun-games:tick --loop` running, or any player request)."
            : 'Started now.');

        return self::SUCCESS;
    }
}
