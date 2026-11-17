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
	ListPublicDecksParams,
	OptionInput,
	OptionOrderEntry,
	OptionWithSlide,
	PublicDeck,
	PublicDeckPage,
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
// routes/deck/authoring.php + media.php, responses camelCase (DeckPresenter /
// SlidePresenter / OptionPresenter). Every function throws DeckApiError.
// There is no upload endpoint here: upload through /library/files
// (features/file-library) and attach the returned file id. Adding slides past
// the cap answers 422 `slide_limit_reached` (data.max_slides).
//
// Quiz (/quizzes): new decks are "Untitled quiz" with settings.get_ready_seconds 5;
// addSlide offers quiz + content types only (422 unsupported_type otherwise) and
// seeds timeLimitSeconds / getReadySeconds / pointsMin 50 / pointsMax 100 /
// speedBonusEnabled true; updateSlide also takes points_min / points_max /
// speed_bonus_enabled (scored types only); addOption / updateOption / bulk
// options also take is_correct and validate quiz payloads (422 payload.<key>).
// Quest routes answer 422 on every quiz-only field.

type Id = number | string;

export interface AuthoringApi {
	readonly product: DeckProduct;
	/** GET / — the user's decks of this product, paginated. */
	listDecks(params?: ListDecksParams, signal?: AbortSignal): Promise<DeckPage>;
	/** POST / — 201, seeded with one qr_code slide at position 1 (quiz: "Untitled quiz", get_ready_seconds 5). */
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

	/** GET /public — Discover: everyone's public decks of this product. */
	listPublicDecks(params?: ListPublicDecksParams, signal?: AbortSignal): Promise<PublicDeckPage>;
	/** GET /public/{deck} — preview of a public deck (or your own); 404 when it is not shared. */
	getPublicDeck(deckId: Id, signal?: AbortSignal): Promise<PublicDeck>;
	/**
	 * POST /public/{deck}/copy — 201 a private copy in your library (same title; your own deck: "Copy of …").
	 * Its images become your own My Files items: 422 `quota_exceeded` when they do not fit.
	 */
	copyPublicDeck(deckId: Id): Promise<Deck>;

	/** POST /{deck}/slides {type, after_position?} — 201 slide with registry defaults. */
	addSlide(deckId: Id, input: AddSlideInput | SlideTypeKey): Promise<SlideWithOrder>;
	/** POST /{deck}/slides/bulk — 1..50 slides, all-or-nothing (422 keyed slides.N.*). */
	addSlidesBulk(deckId: Id, input: BulkSlidesInput): Promise<SlidesWithOrder>;
	/** POST /{deck}/slides/reorder — must cover every live slide; returns the authoritative order. */
	reorderSlides(deckId: Id, order: SlideOrderEntry[]): Promise<SlideOrderEntry[]>;
	/** GET /{deck}/slides/{slide} */
	getSlide(deckId: Id, slideId: Id, signal?: AbortSignal): Promise<Slide>;
	/** PATCH /{deck}/slides/{slide} — config merges recursively (lists replace). Quiz: also points_min / points_max / speed_bonus_enabled. */
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
	/** PATCH /{deck}/slides/{slide}/options/{option} — quiz: also is_correct; payload validated per type (422 payload.<key>). */
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

		listPublicDecks: (params = {}, signal) =>
			deckRequest(async () => {
				const res = await axiosInstance.get<ApiEnvelope<PublicDeckPage>>(`${base}/public`, {
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

		getPublicDeck: (deckId, signal) =>
			deckRequest(async () => {
				const res = await axiosInstance.get<ApiEnvelope<{ deck: PublicDeck }>>(`${base}/public/${deckId}`, { signal, timeout });
				return res.data.data.deck;
			}),

		copyPublicDeck: (deckId) =>
			deckRequest(async () => {
				const res = await axiosInstance.post<ApiEnvelope<{ deck: Deck }>>(`${base}/public/${deckId}/copy`, undefined, {
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

/** Quest authoring (/api/v1/quests). */
export const questAuthoringApi = createAuthoringApi("quest");

/** Quiz authoring (/api/v1/quizzes). */
export const quizAuthoringApi = createAuthoringApi("quiz");

/** The authoring API of a product (shared instances). */
export function authoringApiFor(product: DeckProduct): AuthoringApi {
	return product === "quiz" ? quizAuthoringApi : questAuthoringApi;
}

/**
 * Deletes a deck created for an AI run that never got its slides (the wizard
 * was closed after a failed bulk save). Only while the deck still holds
 * nothing but the seeded qr_code slide, so a bulk save that went through
 * server-side after a client timeout is never thrown away. Best effort:
 * resolves true when the deck was deleted, false otherwise (never throws).
 */
export async function discardSeedOnlyDeck(api: AuthoringApi, deckId: Id): Promise<boolean> {
	try {
		const deck = await api.getDeck(deckId);
		const seedOnly = deck.slides.length === 0 || (deck.slides.length === 1 && deck.slides[0].type === "qr_code");
		if (!seedOnly) return false;
		await api.deleteDeck(deckId);
		return true;
	} catch {
		return false;
	}
}
