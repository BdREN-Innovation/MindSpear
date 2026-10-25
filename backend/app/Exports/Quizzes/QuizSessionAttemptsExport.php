<?php

namespace App\Exports\Quizzes;

use App\Models\Quiz\QuizParticipant;
use App\Models\Quiz\QuizSession;
use App\Services\Quiz\LegacyQuizScorer;
use Illuminate\Support\Collection;
use Maatwebsite\Excel\Concerns\FromCollection;
use Maatwebsite\Excel\Concerns\ShouldAutoSize;
use Maatwebsite\Excel\Concerns\WithCustomCsvSettings;
use Maatwebsite\Excel\Concerns\WithHeadings;
use Maatwebsite\Excel\Concerns\WithMapping;
use Maatwebsite\Excel\Concerns\WithStrictNullComparison;
use Maatwebsite\Excel\Concerns\WithStyles;
use PhpOffice\PhpSpreadsheet\Style\Alignment;
use PhpOffice\PhpSpreadsheet\Style\Border;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;

/**
 * One row per player of a quiz session: who they are, their score, and what they answered to each
 * question (as text, marked correct or wrong).
 *
 * It used to list only questions somebody had answered (in no set order), dropped empty options
 * and renumbered the rest (shifting answers onto the wrong option), showed multiple-answer picks
 * as "0,2,3", and had University / Designation columns that were always empty. Strict null
 * comparison keeps a score of 0 (it was written as an empty cell).
 */
class QuizSessionAttemptsExport implements FromCollection, ShouldAutoSize, WithCustomCsvSettings, WithHeadings, WithMapping, WithStrictNullComparison, WithStyles
{
    private const MULTI_TYPES = ['quiz_multiple_choice', 'fill_in_the_blanks_multiple_choice', 'multiple_choice'];

    private const TYPED_TYPES = ['sort_answer_choice', 'sort_answer', 'short_answer_choice', 'short_answer'];

    private LegacyQuizScorer $scorer;

    /**
     * @param  Collection  $questions  The quiz's questions, in quiz order.
     */
    public function __construct(protected QuizSession $quizSession, protected Collection $questions)
    {
        $this->scorer = app(LegacyQuizScorer::class);
    }

    public function collection()
    {
        // Best first, like the leaderboard.
        return $this->quizSession->participants
            ->map(fn (QuizParticipant $participant) => [$participant, $this->results($participant)])
            ->sortBy([
                fn ($a, $b) => $b[1]['score'] <=> $a[1]['score'],
                fn ($a, $b) => strcasecmp($this->name($a[0]), $this->name($b[0])),
            ])
            ->values();
    }

    public function headings(): array
    {
        $headings = ['Name', 'Email', 'Joined at', 'Status', 'Score', 'Correct answers'];

        foreach ($this->questions->values() as $index => $question) {
            $headings[] = 'Q' . ($index + 1) . '. ' . $this->plainText($question->question_text);
        }

        return $headings;
    }

    public function map($row): array
    {
        [$participant, $results] = $row;

        return [
            $this->name($participant),
            $participant->user->email ?? ($participant->anonymous_details['email'] ?? ''),
            // In the session's timezone (times are stored in UTC).
            optional($participant->start_time ?? $participant->created_at)
                ?->copy()->timezone($this->quizSession->timezone ?: 'UTC')->format('Y-m-d H:i'),
            $participant->status ?? '',
            $results['score'],
            $results['correct'] . ' of ' . $this->questions->count(),
            ...$results['cells'],
        ];
    }

    /**
     * The player's answer to each question, and their score from them (the same rules as the quiz).
     */
    private function results(QuizParticipant $participant): array
    {
        $answers = $participant->userQuizAnswers->keyBy('question_id');
        $score = 0;
        $correct = 0;
        $cells = [];

        foreach ($this->questions as $question) {
            $answer = $answers->get($question->id);
            $selected = $answer?->answer_data['selected_option'] ?? null;

            if ($selected === null || $selected === '' || $selected === []) {
                $cells[] = 'Not answered';

                continue;
            }

            $isCorrect = $this->isCorrect($question, $selected);
            if ($isCorrect) {
                $score += (int) ($question->points ?? 0);
                $correct++;
            }

            $cells[] = $this->answerText($question, $selected) . ($isCorrect ? ' (correct)' : ' (wrong)');
        }

        return ['score' => $score, 'correct' => $correct, 'cells' => $cells];
    }

    private function isCorrect($question, $selected): bool
    {
        $options = is_array($question->options) ? $question->options : [];
        $correct = $options['correct_answer'] ?? null;

        if (in_array($question->question_type, self::TYPED_TYPES, true)) {
            return $this->scorer->shortAnswerMatches($selected, $options);
        }

        if (in_array($question->question_type, self::MULTI_TYPES, true)) {
            return $this->scorer->sameIndexSet($selected, $correct);
        }

        return $correct !== null && ! is_array($selected) && (string) $selected === (string) $correct;
    }

    /** What the player answered, in words: option texts for a pick, their own text for a typed answer. */
    private function answerText($question, $selected): string
    {
        if (in_array($question->question_type, self::TYPED_TYPES, true)) {
            return collect((array) $selected)->map(fn ($part) => trim((string) $part))->filter()->implode(', ');
        }

        $choices = is_array($question->options['choices'] ?? null) ? $question->options['choices'] : [];
        $picked = is_array($selected) ? $selected : explode(',', (string) $selected);

        return collect($picked)
            ->map(fn ($index) => trim((string) $index))
            ->filter(fn ($index) => is_numeric($index))
            ->map(fn ($index) => (int) $index)
            ->unique()
            ->sort()
            ->map(fn (int $index) => trim((string) ($choices[$index] ?? '')) ?: 'Option ' . ($index + 1))
            ->implode(', ');
    }

    private function name(QuizParticipant $participant): string
    {
        return $participant->user->full_name
            ?? $participant->user->name
            ?? ($participant->anonymous_details['name'] ?? 'Unknown player');
    }

    private function plainText(?string $html): string
    {
        return trim(preg_replace('/\s+/', ' ', html_entity_decode(strip_tags((string) $html), ENT_QUOTES | ENT_HTML5)));
    }

    /** A byte-order mark, so Excel opens the CSV as UTF-8 (names with accents came out garbled). */
    public function getCsvSettings(): array
    {
        return ['use_bom' => true];
    }

    public function styles(Worksheet $sheet)
    {
        $lastCell = $sheet->getHighestColumn() . $sheet->getHighestRow();

        $sheet->getStyle('A1:' . $lastCell)->getAlignment()
            ->setWrapText(true)
            ->setVertical(Alignment::VERTICAL_TOP)
            ->setHorizontal(Alignment::HORIZONTAL_LEFT);

        return [
            1 => [
                'font' => ['bold' => true, 'color' => ['rgb' => 'FFFFFF']],
                'fill' => ['fillType' => Fill::FILL_SOLID, 'startColor' => ['rgb' => '6A5ACD']],
            ],
            'A1:' . $lastCell => [
                'borders' => ['allBorders' => ['borderStyle' => Border::BORDER_THIN, 'color' => ['rgb' => 'DDDDDD']]],
            ],
        ];
    }
}
