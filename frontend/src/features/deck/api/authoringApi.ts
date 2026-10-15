import axiosInstance from "@/utils/axiosInstance";
import type {
	AddSlideInput,
	ApiEnvelope,
	BulkSlidesInput,
	CreateDeckInput,
	Deck,
	DeckPage,
	DeckProduct,
	DeckSummary,
	ListDecksParams,
	OptionInput,
	OptionOrderEntry,
	OptionWithSlide,
	Slide,
	SlideOption,
	SlideOrderEntry,
	SlidePatch,
	SlidesWithOrder,
	SlideTypeKey,
	SlideWithOrder,
	UpdateDeckInput,
} from "../types";
import { deckRequest } from "./errors";
import { authoringBase, DECK_TIMEOUTS } from "./routes";

// Deck authoring (owner only, Sanctum via axiosInstance). Backend:
// routes/deck/quest_authoring.php + quest_media.php, responses camelCase
// (DeckPresenter / SlidePresenter / OptionPresenter). Every function throws
// DeckApiError. There is no upload endpoint here: upload through
// /library/files (features/file-library) and attach the returned file id.
//
// Every route answers 403 code `feature_disabled` when the user's
// quest_v2_enabled flag is off; adding slides past the cap answers 422
// `slide_limit_reached` (data.max_slides).

type Id = number | string;

export interface AuthoringApi {
	readonly product: DeckProduct;
	/** GET / — the user's decks of this product, paginated. */
	listDecks(params?: ListDecksParams, signal?: AbortSignal): Promise<DeckPage>;
	/** POST / — 201, seeded with one qr_code slide at position 1. */
	createDeck(input?: CreateDeckInput): Promise<Deck>;
	/** GET /{deck} — detail with slides + options in position order. */
	getDeck(deckId: Id, signal?: AbortSignal): Promise<Deck>;
	/** PATCH /{deck} — settings merge; null resets a key. Returns the summary (no slides). */
	updateDeck(deckId: Id, input: UpdateDeckInput): Promise<DeckSummary>;
	/** DELETE /{deck} — soft delete. */
	deleteDeck(deckId: Id): Promise<void>;
	/** POST /{deck}/duplicate — 201 "Copy of …" with file refs copied. */
	duplicateDeck(deckId: Id): Promise<Deck>;
	/** PUT /{deck}/cover {file_id|null} */
	setCover(deckId: Id, fileId: number | null): Promise<DeckSummary>;

	/** POST /{deck}/slides {type, after_position?} — 201 slide with registry defaults. */
	addSlide(deckId: Id, input: AddSlideInput | SlideTypeKey): Promise<SlideWithOrder>;
	/** POST /{deck}/slides/bulk — 1..50 slides, all-or-nothing (422 keyed slides.N.*). */
	addSlidesBulk(deckId: Id, input: BulkSlidesInput): Promise<SlidesWithOrder>;
	/** POST /{deck}/slides/reorder — must cover every live slide; returns the authoritative order. */
	reorderSlides(deckId: Id, order: SlideOrderEntry[]): Promise<SlideOrderEntry[]>;
	/** GET /{deck}/slides/{slide} */
	getSlide(deckId: Id, slideId: Id, signal?: AbortSignal): Promise<Slide>;
	/** PATCH /{deck}/slides/{slide} — config merges recursively (lists replace). */
	updateSlide(deckId: Id, slideId: Id, patch: SlidePatch): Promise<Slide>;
	/** DELETE /{deck}/slides/{slide} — later slides close up. */
	deleteSlide(deckId: Id, slideId: Id): Promise<SlideOrderEntry[]>;
	/** POST /{deck}/slides/{slide}/duplicate — 201 at the next position. */
	duplicateSlide(deckId: Id, slideId: Id): Promise<SlideWithOrder>;
	/** PUT /{deck}/slides/{slide}/media {file_id|null} — image / mp4 / pin_on_image image (clears config.video_url on video slides). */
	setSlideMediaFile(deckId: Id, slideId: Id, fileId: number | null): Promise<Slide>;
	/** PUT /{deck}/slides/{slide}/media {video_url|null} — YouTube/Vimeo link (clears media_file_id). */
	setSlideVideoUrl(deckId: Id, slideId: Id, videoUrl: string | null): Promise<Slide>;

	/** POST /{deck}/slides/{slide}/options — 201, appended last. */
	addOption(deckId: Id, slideId: Id, input?: OptionInput): Promise<OptionWithSlide>;
	/** PATCH /{deck}/slides/{slide}/options/{option} */
	updateOption(deckId: Id, slideId: Id, optionId: Id, input: OptionInput): Promise<OptionWithSlide>;
	/** DELETE /{deck}/slides/{slide}/options/{option} — 422 `options` below the minimum. Returns the slide. */
	deleteOption(deckId: Id, slideId: Id, optionId: Id): Promise<Slide>;
	/** PUT /{deck}/slides/{slide}/options/{option}/image {file_id|null} */
	setOptionImage(deckId: Id, slideId: Id, optionId: Id, fileId: number | null): Promise<SlideOption>;
	/**
	 * POST /{deck}/slides/{slide}/options/reorder {options: [{id, position}]} — every option once,
	 * positions 1..n. Pass the option ids in their new order (or explicit entries). 409 conflict = refetch the slide.
	 */
	reorderOptions(deckId: Id, slideId: Id, order: number[] | OptionOrderEntry[]): Promise<Slide>;
}

export function createAuthoringApi(product: DeckProduct): AuthoringApi {
	const base = authoringBase(product);
	const deckUrl = (deckId: Id) => `${base}/${deckId}`;
	const slideUrl = (deckId: Id, slideId: Id) => `${deckUrl(deckId)}/slides/${slideId}`;
	const optionUrl = (deckId: Id, slideId: Id, optionId: Id) => `${slideUrl(deckId, slideId)}/options/${optionId}`;
	const timeout = DECK_TIMEOUTS.default;

	return {
		product,

		listDecks: (params = {}, signal) =>
			deckRequest(async () => {
				const res = await axiosInstance.get<ApiEnvelope<DeckPage>>(base, {
					params: {
						search: params.search || undefined,
						sort: params.sort,
						direction: params.direction,
						per_page: params.perPage,
						page: params.page,
					},
					signal,
					timeout,
				});
				return res.data.data;
			}),

		createDeck: (input = {}) =>
			deckRequest(async () => {
				const res = await axiosInstance.post<ApiEnvelope<{ deck: Deck }>>(base, input, { timeout });
				return res.data.data.deck;
			}),

		getDeck: (deckId, signal) =>
			deckRequest(async () => {
				const res = await axiosInstance.get<ApiEnvelope<{ deck: Deck }>>(deckUrl(deckId), { signal, timeout });
				return res.data.data.deck;
			}),

		updateDeck: (deckId, input) =>
			deckRequest(async () => {
				const res = await axiosInstance.patch<ApiEnvelope<{ deck: DeckSummary }>>(deckUrl(deckId), input, { timeout });
				return res.data.data.deck;
			}),

		deleteDeck: (deckId) =>
			deckRequest(async () => {
				await axiosInstance.delete(deckUrl(deckId), { timeout });
			}),

		duplicateDeck: (deckId) =>
			deckRequest(async () => {
				const res = await axiosInstance.post<ApiEnvelope<{ deck: Deck }>>(`${deckUrl(deckId)}/duplicate`, undefined, {
					timeout: DECK_TIMEOUTS.duplicate,
				});
				return res.data.data.deck;
			}),

		setCover: (deckId, fileId) =>
			deckRequest(async () => {
				const res = await axiosInstance.put<ApiEnvelope<{ deck: DeckSummary }>>(
					`${deckUrl(deckId)}/cover`,
					{ file_id: fileId },
					{ timeout }
				);
				return res.data.data.deck;
			}),

		addSlide: (deckId, input) =>
			deckRequest(async () => {
				const body: AddSlideInput = typeof input === "string" ? { type: input } : input;
				const res = await axiosInstance.post<ApiEnvelope<SlideWithOrder>>(`${deckUrl(deckId)}/slides`, body, {
					timeout,
				});
				return res.data.data;
			}),

		addSlidesBulk: (deckId, input) =>
			deckRequest(async () => {
				const res = await axiosInstance.post<ApiEnvelope<SlidesWithOrder>>(`${deckUrl(deckId)}/slides/bulk`, input, {
					timeout: DECK_TIMEOUTS.bulk,
				});
				return res.data.data;
			}),

		reorderSlides: (deckId, order) =>
			deckRequest(async () => {
				const res = await axiosInstance.post<ApiEnvelope<{ order: SlideOrderEntry[] }>>(
					`${deckUrl(deckId)}/slides/reorder`,
					{ slides: order.map(({ id, position }) => ({ id, position })) },
					{ timeout }
				);
				return res.data.data.order;
			}),

		getSlide: (deckId, slideId, signal) =>
			deckRequest(async () => {
				const res = await axiosInstance.get<ApiEnvelope<{ slide: Slide }>>(slideUrl(deckId, slideId), {
					signal,
					timeout,
				});
				return res.data.data.slide;
			}),

		updateSlide: (deckId, slideId, patch) =>
			deckRequest(async () => {
				const res = await axiosInstance.patch<ApiEnvelope<{ slide: Slide }>>(slideUrl(deckId, slideId), patch, {
					timeout,
				});
				return res.data.data.slide;
			}),

		deleteSlide: (deckId, slideId) =>
			deckRequest(async () => {
				const res = await axiosInstance.delete<ApiEnvelope<{ order: SlideOrderEntry[] }>>(slideUrl(deckId, slideId), {
					timeout,
				});
				return res.data.data.order;
			}),

		duplicateSlide: (deckId, slideId) =>
			deckRequest(async () => {
				const res = await axiosInstance.post<ApiEnvelope<SlideWithOrder>>(
					`${slideUrl(deckId, slideId)}/duplicate`,
					undefined,
					{ timeout }
				);
				return res.data.data;
			}),

		setSlideMediaFile: (deckId, slideId, fileId) =>
			deckRequest(async () => {
				const res = await axiosInstance.put<ApiEnvelope<{ slide: Slide }>>(
					`${slideUrl(deckId, slideId)}/media`,
					{ file_id: fileId },
					{ timeout }
				);
				return res.data.data.slide;
			}),

		setSlideVideoUrl: (deckId, slideId, videoUrl) =>
			deckRequest(async () => {
				const res = await axiosInstance.put<ApiEnvelope<{ slide: Slide }>>(
					`${slideUrl(deckId, slideId)}/media`,
					{ video_url: videoUrl },
					{ timeout }
				);
				return res.data.data.slide;
			}),

		addOption: (deckId, slideId, input = {}) =>
			deckRequest(async () => {
				const res = await axiosInstance.post<ApiEnvelope<OptionWithSlide>>(
					`${slideUrl(deckId, slideId)}/options`,
					input,
					{ timeout }
				);
				return res.data.data;
			}),

		updateOption: (deckId, slideId, optionId, input) =>
			deckRequest(async () => {
				const res = await axiosInstance.patch<ApiEnvelope<OptionWithSlide>>(
					optionUrl(deckId, slideId, optionId),
					input,
					{ timeout }
				);
				return res.data.data;
			}),

		deleteOption: (deckId, slideId, optionId) =>
			deckRequest(async () => {
				const res = await axiosInstance.delete<ApiEnvelope<{ slide: Slide }>>(optionUrl(deckId, slideId, optionId), {
					timeout,
				});
				return res.data.data.slide;
			}),

		setOptionImage: (deckId, slideId, optionId, fileId) =>
			deckRequest(async () => {
				const res = await axiosInstance.put<ApiEnvelope<{ option: SlideOption }>>(
					`${optionUrl(deckId, slideId, optionId)}/image`,
					{ file_id: fileId },
					{ timeout }
				);
				return res.data.data.option;
			}),

		reorderOptions: (deckId, slideId, order) =>
			deckRequest(async () => {
				const options: OptionOrderEntry[] = order.map((entry, index) =>
					typeof entry === "number" ? { id: entry, position: index + 1 } : { id: entry.id, position: entry.position }
				);
				const res = await axiosInstance.post<ApiEnvelope<{ slide: Slide }>>(
					`${slideUrl(deckId, slideId)}/options/reorder`,
					{ options },
					{ timeout }
				);
				return res.data.data.slide;
			}),
	};
}

/** Quest v2 authoring (/api/v1/quests/v2). */
export const questAuthoringApi = createAuthoringApi("quest");
