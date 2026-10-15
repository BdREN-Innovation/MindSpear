import type { MediaFile, RunMedia, RunViewOf, SlideConfigMap, SlideOf, SlideTypeKey } from "../types";

// The editor canvas renders each type's Presenter, which takes a live run
// view. This builds the run view a session would snapshot from an authoring
// slide (same rules as SessionLauncher + serializeForParticipant), so the
// canvas preview matches what the host will see in Present mode.

/** Types whose snapshot config carries server-owned `media` (TakesMedia with media). */
const MEDIA_TYPES: readonly SlideTypeKey[] = ["image", "video", "pin_on_image"];

export function mediaFileToRunMedia(file: MediaFile | null): RunMedia | null {
	return file ? { file_id: file.fileId, url: file.url, width: file.width, height: file.height, mime: file.mime } : null;
}

/** A `waiting` run view of an authoring slide (id = slide id). */
export function slideToRunView<K extends SlideTypeKey>(
	slide: SlideOf<K>,
	overrides: Partial<Pick<RunViewOf<K>, "state" | "state_version">> = {}
): RunViewOf<K> {
	const config = (
		MEDIA_TYPES.includes(slide.type) ? { ...slide.config, media: mediaFileToRunMedia(slide.media) } : { ...slide.config }
	) as SlideConfigMap[K];

	return {
		id: slide.id,
		slide_id: slide.id,
		type: slide.type,
		category: slide.category,
		reveal_model: slide.revealModel,
		accepts_answers: !!slide.acceptsAnswers,
		position: slide.position,
		title: slide.title,
		body: slide.body,
		config,
		options: slide.options.map((option) => ({
			id: option.id,
			position: option.position,
			label: option.label,
			image_url: option.image?.url ?? null,
			payload: option.payload,
		})),
		state: overrides.state ?? "waiting",
		state_version: overrides.state_version ?? 0,
		time_limit_seconds: slide.timeLimitSeconds,
		get_ready_seconds: slide.getReadySeconds,
		state_started_at: null,
		voting_started_at: null,
		closed_at: null,
	} as unknown as RunViewOf<K>;
}
