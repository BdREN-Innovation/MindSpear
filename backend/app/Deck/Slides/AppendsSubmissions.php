<?php

namespace App\Deck\Slides;

/**
 * A slide type whose participants may submit more than once (Word Cloud,
 * Open Ended). deck_participant_answers keeps one row per participant per
 * run, so later submissions are merged into that row's payload instead of
 * inserted as new rows.
 *
 * Answer endpoint flow. The merge is read-modify-write, so it must hold a row
 * lock: without one, two near-simultaneous submissions (double tap, mobile
 * retry) both read the same previous payload and the last write silently
 * drops the other's entry; updateOrCreate's create fallback has the same race
 * on the first submission.
 *
 *   $incoming = $type->validateAnswer($payload, $config, $options);
 *   DB::transaction(function () use (...) {
 *       // ON CONFLICT DO NOTHING on unique(deck_participant_id, slide_run_id).
 *       // insertOrIgnore skips Eloquent casts: json_encode the payload and
 *       // set the timestamps yourself.
 *       $inserted = DeckParticipantAnswer::query()->insertOrIgnore([...row with $incoming...]);
 *       if ($inserted === 0) {
 *           $row = DeckParticipantAnswer::query()
 *               ->where('deck_participant_id', $participant->id)
 *               ->where('slide_run_id', $run->id)
 *               ->lockForUpdate()
 *               ->firstOrFail();
 *           $row->answer_payload = $type instanceof AppendsSubmissions
 *               ? $type->mergeSubmissions($row->answer_payload, $incoming, $config)
 *               : $incoming; // other types replace
 *           $row->submitted_at = now();
 *           $row->save();
 *       }
 *   });
 *
 * Cover it with a concurrency test (two submissions racing on one row must
 * keep both entries).
 */
interface AppendsSubmissions
{
    /** Whether a second submission adds to the first rather than replacing it. */
    public function allowsMultipleSubmissions(array $config): bool;

    /**
     * Payload to store after a repeat submission. Both payloads are normalised
     * (validateAnswer output). Replaces when multiple submissions are off.
     *
     * @throws \Illuminate\Validation\ValidationException when the per-participant cap would be exceeded
     */
    public function mergeSubmissions(array $previous, array $incoming, array $config): array;
}
