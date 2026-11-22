<?php

namespace App\Deck\Legacy;

use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Read-only results of the legacy v1 quizzes and quests (sessions, participants, answers),
 * for their owners. Reads the old tables as they are: the v1 app never stored scores and its
 * response times are unreliable, so nothing is recalculated except right / wrong per quiz
 * answer, which follows from the question's own correct_answer.
 *
 * Sources: quiz → quizes, questions, quiz_sessions, quiz_participants, user_quiz_answers;
 *          quest → quests, quest_tasks, quest_sessions, quest_participants, quest_task_completions.
 */
class LegacyResults
{
    /** The session id used for participants the v1 app stored without one. */
    public const NO_SESSION = 'none';

    private const SOURCES = [
        LegacyDeckImport::SOURCE_QUIZ => [
            'table' => 'quizes', 'owner' => 'user_id', 'items' => 'questions', 'item_parent' => 'quiz_id',
            'sessions' => 'quiz_sessions', 'session_parent' => 'quiz_id',
            'participants' => 'quiz_participants', 'participant_parent' => 'quiz_id', 'participant_session' => 'quiz_session_id',
            'answers' => 'user_quiz_answers', 'answer_participant' => 'quiz_participant_id', 'answer_item' => 'question_id',
        ],
        LegacyDeckImport::SOURCE_QUEST => [
            'table' => 'quests', 'owner' => 'creator_id', 'items' => 'quest_tasks', 'item_parent' => 'quest_id',
            'sessions' => 'quest_sessions', 'session_parent' => 'quest_id',
            'participants' => 'quest_participants', 'participant_parent' => 'quest_id', 'participant_session' => 'quest_session_id',
            'answers' => 'quest_task_completions', 'answer_participant' => 'participant_id', 'answer_item' => 'task_id',
        ],
    ];

    public static function sources(): array
    {
        return array_keys(self::SOURCES);
    }

    /** $owner's legacy quizzes and quests that anyone took part in, most recently played first. */
    public function index(User $owner): array
    {
        $rows = [];
        foreach (self::SOURCES as $source => $t) {
            $counts = DB::table($t['participants'])
                ->select($t['participant_parent'] . ' as parent_id')
                ->selectRaw('count(*) as participants, count(distinct ' . $t['participant_session'] . ') as sessions, max(created_at) as last_played_at')
                ->groupBy($t['participant_parent']);

            $found = DB::table($t['table'] . ' as s')
                ->joinSub($counts, 'c', 'c.parent_id', '=', 's.id')
                ->where('s.' . $t['owner'], $owner->id)
                ->whereNull('s.deleted_at')
                ->get(['s.id', 's.title', 's.created_at', 'c.participants', 'c.sessions', 'c.last_played_at']);

            $decks = LegacyDeckImport::query()->where('source_type', $source)->whereIn('source_id', $found->pluck('id'))->pluck('deck_id', 'source_id');

            foreach ($found as $row) {
                $rows[] = [
                    'source' => $source,
                    'id' => (int) $row->id,
                    'title' => $row->title,
                    'deck_id' => $decks[$row->id] ?? null,
                    'sessions' => (int) $row->sessions,
                    'participants' => (int) $row->participants,
                    'created_at' => self::time($row->created_at),
                    'last_played_at' => self::time($row->last_played_at),
                ];
            }
        }

        usort($rows, fn ($a, $b) => strcmp((string) $b['last_played_at'], (string) $a['last_played_at']));

        return $rows;
    }

    /** One legacy quiz / quest of $owner with its sessions, or null when it isn't theirs. */
    public function show(User $owner, string $source, int $id): ?array
    {
        $parent = $this->parent($owner, $source, $id);
        if ($parent === null) {
            return null;
        }
        $t = self::SOURCES[$source];

        $perSession = DB::table($t['participants'])->where($t['participant_parent'], $id)
            ->select($t['participant_session'] . ' as session_id')->selectRaw('count(*) as participants, min(created_at) as first_join')
            ->groupBy($t['participant_session'])->get()->keyBy(fn ($r) => $r->session_id ?? self::NO_SESSION);

        $sessions = DB::table($t['sessions'])->where($t['session_parent'], $id)->orderByDesc('start_datetime')->orderByDesc('id')
            ->get()
            ->filter(fn ($s) => isset($perSession[$s->id]))
            ->map(fn ($s) => [
                'id' => (string) $s->id,
                'title' => $s->title,
                'join_code' => $s->join_code ?? null,
                'started_at' => self::time($s->start_datetime ?? $s->created_at),
                'ended_at' => self::time($s->end_datetime),
                'participants' => (int) $perSession[$s->id]->participants,
            ])->values()->all();

        if (isset($perSession[self::NO_SESSION])) {
            $sessions[] = [
                'id' => self::NO_SESSION, 'title' => 'Without a session', 'join_code' => null,
                'started_at' => self::time($perSession[self::NO_SESSION]->first_join), 'ended_at' => null,
                'participants' => (int) $perSession[self::NO_SESSION]->participants,
            ];
        }

        return [
            'source' => $source,
            'id' => $id,
            'title' => $parent->title,
            'deck_id' => LegacyDeckImport::query()->where('source_type', $source)->where('source_id', $id)->value('deck_id'),
            'scored' => $source === LegacyDeckImport::SOURCE_QUIZ,
            'sessions' => $sessions,
        ];
    }

    /**
     * One session: its questions (with how many answered / answered right) and every
     * participant with their answers. Null when the quiz / quest or session isn't $owner's.
     */
    public function session(User $owner, string $source, int $id, string $sessionId): ?array
    {
        $parent = $this->parent($owner, $source, $id);
        if ($parent === null) {
            return null;
        }
        $t = self::SOURCES[$source];
        $quiz = $source === LegacyDeckImport::SOURCE_QUIZ;

        $session = null;
        if ($sessionId !== self::NO_SESSION) {
            $session = ctype_digit($sessionId)
                ? DB::table($t['sessions'])->where('id', (int) $sessionId)->where($t['session_parent'], $id)->first()
                : null;
            if ($session === null) {
                return null;
            }
        }

        $participants = DB::table($t['participants'] . ' as p')
            ->leftJoin('users as u', 'u.id', '=', 'p.user_id')
            ->where('p.' . $t['participant_parent'], $id)
            ->when($session, fn ($q) => $q->where('p.' . $t['participant_session'], $session->id), fn ($q) => $q->whereNull('p.' . $t['participant_session']))
            ->orderBy('p.created_at')->orderBy('p.id')
            ->get(['p.id', 'p.anonymous_details', 'p.created_at', 'u.first_name', 'u.last_name', 'u.email']);

        $answers = DB::table($t['answers'])
            ->whereIn($t['answer_participant'], $participants->pluck('id'))
            ->orderBy('id')
            ->get()
            ->groupBy($t['answer_participant']);

        // Every live question, plus deleted ones that this session answered.
        $answered = $answers->flatten(1)->pluck($t['answer_item'])->unique()->all();
        $items = DB::table($t['items'])->where($t['item_parent'], $id)
            ->where(fn ($q) => $q->whereNull('deleted_at')->orWhereIn('id', $answered))
            ->orderByRaw('serial_number NULLS LAST')->orderBy('id')->get()
            ->filter(fn ($item) => ! $quiz || $item->question_type !== null || in_array($item->id, $answered))
            ->values();

        $questions = $items->map(fn ($item, $index) => $quiz ? [
            'id' => (int) $item->id,
            'number' => $index + 1,
            'text' => $item->question_text,
            'type' => $item->question_type,
            'deleted' => $item->deleted_at !== null,
            'correct_answer' => LegacyAnswers::quizCorrectText($item),
            'answered' => 0,
            'correct' => 0,
        ] : [
            'id' => (int) $item->id,
            'number' => $index + 1,
            'text' => $item->title,
            'type' => $item->task_type,
            'deleted' => $item->deleted_at !== null,
            'correct_answer' => null,
            'answered' => 0,
            'correct' => null,
        ])->keyBy('id')->all();
        $itemsById = $items->keyBy('id');

        $people = [];
        $raw = [];
        foreach ($participants as $p) {
            $row = ['id' => (int) $p->id, 'name' => self::name($p), 'joined_at' => self::time($p->created_at), 'answered' => 0, 'correct' => $quiz ? 0 : null, 'answers' => []];
            foreach ($answers[$p->id] ?? [] as $answer) {
                $item = $itemsById[$answer->{$t['answer_item']}] ?? null;
                if ($item === null) {
                    continue;
                }
                $data = LegacyAnswers::json($quiz ? $answer->answer_data : $answer->completion_data);
                $result = $quiz ? LegacyAnswers::quiz($item, $data) : LegacyAnswers::quest($item, $data);
                $raw[$item->id][] = $data;

                $row['answers'][(string) $item->id] = $result;
                $row['answered']++;
                $questions[$item->id]['answered']++;
                if ($quiz && $result['correct'] === true) {
                    $row['correct']++;
                    $questions[$item->id]['correct']++;
                }
            }
            $people[] = $row;
        }

        foreach ($questions as $itemId => &$question) {
            $question['summary'] = LegacyAnswers::summary($itemsById[$itemId], $raw[$itemId] ?? [], $quiz);
        }
        unset($question);

        return [
            'source' => $source,
            'id' => $id,
            'title' => $parent->title,
            'scored' => $quiz,
            'session' => [
                'id' => $session ? (string) $session->id : self::NO_SESSION,
                'title' => $session->title ?? 'Without a session',
                'started_at' => self::time($session->start_datetime ?? $session->created_at ?? null),
                'ended_at' => self::time($session->end_datetime ?? null),
            ],
            'questions' => array_values($questions),
            'participants' => $people,
        ];
    }

    /** The session as CSV rows: one per participant, one column per question. */
    public function csv(array $session): Collection
    {
        $questions = $session['questions'];
        $header = ['Participant', 'Joined at', 'Answered'];
        if ($session['scored']) {
            $header[] = 'Correct';
        }
        foreach ($questions as $q) {
            $header[] = 'Q' . $q['number'] . ': ' . $q['text'];
        }

        $rows = collect([$header]);
        foreach ($session['participants'] as $p) {
            $line = [$p['name'], $p['joined_at'], $p['answered']];
            if ($session['scored']) {
                $line[] = $p['correct'];
            }
            foreach ($questions as $q) {
                $a = $p['answers'][(string) $q['id']] ?? null;
                $line[] = $a === null ? '' : $a['text'] . match ($a['correct'] ?? null) {
                    true => ' (correct)', false => ' (wrong)', default => '',
                };
            }
            $rows->push($line);
        }

        return $rows;
    }

    private function parent(User $owner, string $source, int $id): ?object
    {
        $t = self::SOURCES[$source] ?? null;

        return $t === null ? null : DB::table($t['table'])->where('id', $id)->where($t['owner'], $owner->id)->whereNull('deleted_at')->first();
    }

    private static function name(object $p): string
    {
        $details = LegacyAnswers::json($p->anonymous_details);
        $name = trim((string) ($details['name'] ?? ''));
        if ($name !== '') {
            return $name;
        }
        $name = trim(($p->first_name ?? '') . ' ' . ($p->last_name ?? ''));

        return $name !== '' ? $name : 'Anonymous';
    }

    private static function time(mixed $value): ?string
    {
        return $value === null ? null : \Illuminate\Support\Carbon::parse($value)->toIso8601String();
    }
}
