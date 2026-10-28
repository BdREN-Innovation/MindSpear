import type { DragDropConfig, FillBlanksConfig, MediaFile, RunMedia, RunViewOf, SlideOf, SlideOption, SlideTypeKey } from "../types";
import { isScoredQuizSlideTypeKey } from "../types";
import { dragDropPublicConfig, fillBlanksPublicConfig } from "./blanks";
import { previewOptionKey, slideScoring, spinnerSegments } from "./quiz";

// The editor canvas renders each type's Presenter, which takes a live run
// view. This builds the run view a session would snapshot from an authoring
// slide (same rules as SessionLauncher + serializeForParticipant), so the
// canvas preview matches what the host will see in Present mode.
//
// Quiz types follow their participant views: scored runs get `config.scoring`
// from the slide columns; match_pairs / correct_order / categorise options get
// previewOptionKey(id) as their (opaque) id and lose answer-key payload keys
// (author order kept, match_pairs left cells first; no shuffle); short_answer
// shows no options (accepted answers are never public); spinner_wheel gets
// its wheel `segments`. Pick answer / true_false get config.multiple_answers;
// fill_blanks / drag_drop get the public sentence (parts + blanks, answers
// left out) and drag_drop its word bank as options.

/** Types whose snapshot config carries server-owned `media` (TakesMedia with media). */
const MEDIA_TYPES: readonly SlideTypeKey[] = ["image", "video", "pin_on_image"];

export function mediaFileToRunMedia(file: MediaFile | null): RunMedia | null {
	return file ? { file_id: file.fileId, url: file.url, width: file.width, height: file.height, mime: file.mime } : null;
}

type PreviewOption = { id: number | string; position: number; label: string | null; image_url: string | null; payload: unknown };

function previewOptions(slide: SlideOf): PreviewOption[] {
	const sorted = [...slide.options].sort((a, b) => a.position - b.position || a.id - b.id);
	const row = (option: SlideOption, payload: unknown, opaque: boolean): PreviewOption => ({
		id: opaque ? previewOptionKey(option.id) : option.id,
		position: option.position,
		label: option.label,
		image_url: option.image?.url ?? null,
		payload,
	});

	switch (slide.type) {
		case "short_answer":
		case "leaderboard":
		case "fill_blanks":
			return [];
		case "drag_drop":
			return dragDropPublicConfig(slide.config as DragDropConfig).bank.map((word, index) => ({
				id: previewOptionKey(index + 1),
				position: index + 1,
				label: word,
				image_url: null,
				payload: {},
			}));
		case "match_pairs": {
			const side = (option: SlideOption) => (option.payload as { side?: unknown }).side;
			const ordered = [...sorted.filter((o) => side(o) === "left"), ...sorted.filter((o) => side(o) !== "left")];
			return ordered.map((option, index) => ({ ...row(option, { side: side(option) }, true), position: index + 1 }));
		}
		case "correct_order":
		case "categorise":
			return sorted.map((option, index) => ({ ...row(option, {}, true), position: index + 1 }));
		default:
			return slide.options.map((option) => row(option, option.payload, false));
	}
}

/** QuizOptions::isCorrect: the is_correct column, or a payload is_correct when the column is null. */
function isMarkedCorrect(option: SlideOption): boolean {
	if (option.isCorrect !== null && option.isCorrect !== undefined) return option.isCorrect === true;
	return (option.payload as { is_correct?: unknown } | null)?.is_correct === true;
}

/** A `waiting` run view of an authoring slide (id = slide id). */
export function slideToRunView<K extends SlideTypeKey>(
	slide: SlideOf<K>,
	overrides: Partial<Pick<RunViewOf<K>, "state" | "state_version">> = {}
): RunViewOf<K> {
	const source = slide as SlideOf;
	let config: Record<string, unknown> = MEDIA_TYPES.includes(source.type)
		? { ...source.config, media: mediaFileToRunMedia(source.media) }
		: { ...source.config };
	if (source.type === "pick_answer_single") config = { ...config, multiple_answers: source.options.filter(isMarkedCorrect).length > 1 };
	if (source.type === "true_false") config = { ...config, multiple_answers: false };
	if (source.type === "fill_blanks") config = { ...fillBlanksPublicConfig(source.config as FillBlanksConfig) };
	if (source.type === "drag_drop") {
		const { parts, blanks } = dragDropPublicConfig(source.config as DragDropConfig);
		config = { parts, blanks };
	}
	if (isScoredQuizSlideTypeKey(source.type)) config = { ...config, scoring: slideScoring(source) };

	const extras = source.type === "spinner_wheel" ? { segments: spinnerSegments(source.options) } : {};

	return {
		id: source.id,
		slide_id: source.id,
		type: source.type,
		category: source.category,
		reveal_model: source.revealModel,
		accepts_answers: !!source.acceptsAnswers,
		position: source.position,
		title: source.title,
		body: source.body,
		config,
		options: previewOptions(source),
		state: overrides.state ?? "waiting",
		state_version: overrides.state_version ?? 0,
		time_limit_seconds: source.timeLimitSeconds,
		get_ready_seconds: source.getReadySeconds,
		state_started_at: null,
		voting_started_at: null,
		closed_at: null,
		...extras,
	} as unknown as RunViewOf<K>;
}
