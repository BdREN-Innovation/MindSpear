"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { toast } from "react-toastify";
import { questAuthoringApi, type AuthoringApi } from "@/features/deck/api/authoringApi";
import { toDeckApiError, type DeckApiError } from "@/features/deck/api/errors";
import {
	DECK_LIMITS,
	resolveDeckSettings,
	type BulkSlidesInput,
	type Deck,
	type DeckSettings,
	type DeckSettingsPatch,
	type DeckVisibility,
	type DeckSummary,
	type OptionInput,
	type Slide,
	type SlideOption,
	type SlideOrderEntry,
	type SlidePatch,
	type SlideTypeKey,
} from "@/features/deck/types";
import type { OptionsApi, SlideMediaApi } from "../slides/types";
import {
	applyOptionInput,
	applySlidePatch,
	isEmptyPatch,
	mergePatches,
	moveItem,
	reorderOptionsLocally,
} from "./patch";

// State + autosave for the deck editor (plan §5.3).
//
// Every slide is shown as `confirmed` (last server copy) with optimistic
// "layers" on top: the debounced PATCH being typed, the PATCH in flight,
// option label edits, an option reorder. A layer is removed when its request
// settles, so a failed request rolls back by itself while newer typing stays.
// Slide-scoped requests run one at a time per slide (responses always carry
// the newest server copy); structural requests (add / delete / duplicate /
// reorder) run one at a time per deck because each answers the full order.

export type SaveStatus = "saved" | "unsaved" | "saving" | "error";

type Layer = { key: string; apply: (slide: Slide) => Slide };
type DeckMeta = Omit<Deck, "slides">;
type FieldErrors = Record<string, string[]>;
type Waiter = { resolve: (option: SlideOption) => void; reject: (error: unknown) => void };
type PendingOption = { slideId: number; input: OptionInput; waiters: Waiter[] };

const AUTOSAVE_MS = 500;
const RETRY_MS = 5000;
const PENDING_LAYER = "pending";

/** Errors worth retrying: the request never got a real answer. */
function isTransient(error: DeckApiError): boolean {
	return error.code === "network" || error.code === "timeout" || error.code === "too_many_requests" || error.status >= 500;
}

function patchErrorKeys(patch: SlidePatch): string[] {
	const keys: string[] = [];
	for (const key of Object.keys(patch)) {
		if (key === "config" && patch.config) {
			keys.push("config", ...Object.keys(patch.config).map((k) => `config.${k}`));
		} else {
			keys.push(key);
		}
	}
	return keys;
}

const PATCH_ERROR_PREFIXES = [
	"title",
	"body",
	"config",
	"time_limit_seconds",
	"get_ready_seconds",
	"points_min",
	"points_max",
	"speed_bonus_enabled",
	"slides",
];

export interface DeckEditor {
	loadState: "loading" | "ready" | "error";
	loadError: DeckApiError | null;
	deck: Deck | null;
	selectedId: number | null;
	select(slideId: number | null): void;
	saveStatus: SaveStatus;
	errorsFor(slideId: number): FieldErrors | undefined;
	patchSlide(slideId: number, patch: SlidePatch, options?: { immediate?: boolean }): void;
	optionsApiFor(slide: Slide): OptionsApi;
	mediaApiFor(slideId: number): SlideMediaApi;
	/** `select: false` adds it without leaving the slide being edited. */
	addSlide(type: SlideTypeKey, afterPosition?: number | null, options?: { select?: boolean }): Promise<Slide | null>;
	/** AI bulk insert; throws DeckApiError (the wizard shows it). */
	addSlides(input: BulkSlidesInput): Promise<Slide[]>;
	duplicateSlide(slideId: number): Promise<Slide | null>;
	/** Optimistic delete; returns its neighbour (selected next when the deleted slide was the selected one). */
	deleteSlide(slideId: number): number | null;
	moveSlide(slideId: number, toIndex: number): void;
	setTitle(title: string): void;
	commitTitle(): void;
	updateSettings(patch: DeckSettingsPatch): Promise<void>;
	/** Private / public (Discover). Optimistic; throws DeckApiError after rolling back. */
	setVisibility(visibility: DeckVisibility): Promise<void>;
	flushAll(): Promise<void>;
	reload(): void;
}

export interface UseDeckEditorOptions {
	/** Select this slide once the deck has loaded (and again whenever it changes); ignored when the deck has no such slide. */
	preferredSlideId?: number | null;
}

export function useDeckEditor(
	deckId: string | number,
	api: AuthoringApi = questAuthoringApi,
	{ preferredSlideId = null }: UseDeckEditorOptions = {}
): DeckEditor {
	const [loadState, setLoadState] = useState<DeckEditor["loadState"]>("loading");
	const [loadError, setLoadError] = useState<DeckApiError | null>(null);
	const [selectedId, setSelectedId] = useState<number | null>(null);
	const [errors, setErrors] = useState<Record<number, FieldErrors>>({});
	const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
	const [version, bump] = useReducer((n: number) => n + 1, 0);
	const [loadKey, reload] = useReducer((n: number) => n + 1, 0);

	const metaRef = useRef<DeckMeta | null>(null);
	const confirmedMetaRef = useRef<{ title: string; settings: DeckSettings } | null>(null);
	const confirmedRef = useRef(new Map<number, Slide>());
	const localRef = useRef(new Map<number, Slide>());
	const layersRef = useRef(new Map<number, Layer[]>());
	const orderRef = useRef<number[]>([]);
	const pendingPatchRef = useRef(new Map<number, SlidePatch>());
	const patchTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
	const patchQueuedRef = useRef(new Map<number, Promise<void>>());
	const pendingOptionRef = useRef(new Map<number, PendingOption>());
	const optionTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
	const slideQueuesRef = useRef(new Map<number, Promise<unknown>>());
	const deckQueueRef = useRef<Promise<unknown>>(Promise.resolve());
	const reorderQueuedRef = useRef<{ rollback: number[] } | null>(null);
	const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const busyRef = useRef(0);
	const failedRef = useRef(false);
	const seqRef = useRef(0);
	// The preferred slide is applied once per value, so later clicks in the rail win.
	const preferredRef = useRef(preferredSlideId);
	preferredRef.current = preferredSlideId;
	const appliedPreferredRef = useRef<number | null>(null);

	const editor = useMemo(() => {
		const nextKey = (prefix: string) => `${prefix}:${++seqRef.current}`;

		const refreshStatus = () => {
			const pending = patchTimersRef.current.size + optionTimersRef.current.size + (titleTimerRef.current ? 1 : 0);
			setSaveStatus(busyRef.current > 0 ? "saving" : failedRef.current ? "error" : pending > 0 ? "unsaved" : "saved");
		};

		async function track<T>(run: () => Promise<T>): Promise<T> {
			busyRef.current += 1;
			refreshStatus();
			try {
				const result = await run();
				failedRef.current = false;
				return result;
			} finally {
				busyRef.current -= 1;
				refreshStatus();
			}
		}

		/* ---------------------------- slide copies ---------------------------- */

		const recompute = (slideId: number) => {
			const base = confirmedRef.current.get(slideId);
			if (!base) {
				localRef.current.delete(slideId);
				return;
			}
			const layers = layersRef.current.get(slideId) ?? [];
			localRef.current.set(
				slideId,
				layers.reduce((slide, layer) => layer.apply(slide), base)
			);
		};

		const hasLayer = (slideId: number, key: string) => (layersRef.current.get(slideId) ?? []).some((l) => l.key === key);

		const addLayer = (slideId: number, layer: Layer) => {
			layersRef.current.set(slideId, [...(layersRef.current.get(slideId) ?? []), layer]);
			recompute(slideId);
		};

		const removeLayer = (slideId: number, key: string) => {
			const layers = layersRef.current.get(slideId);
			if (!layers) return;
			layersRef.current.set(
				slideId,
				layers.filter((l) => l.key !== key)
			);
			recompute(slideId);
		};

		const replaceLayer = (slideId: number, key: string, layer: Layer) => {
			const layers = layersRef.current.get(slideId) ?? [];
			const index = layers.findIndex((l) => l.key === key);
			const next = layers.slice();
			if (index >= 0) next[index] = layer;
			else next.push(layer);
			layersRef.current.set(slideId, next);
			recompute(slideId);
		};

		/** Keep slide.position in step with the order (1-based). */
		const syncPositions = () => {
			orderRef.current.forEach((id, index) => {
				const slide = confirmedRef.current.get(id);
				if (slide && slide.position !== index + 1) {
					confirmedRef.current.set(id, { ...slide, position: index + 1 } as Slide);
					recompute(id);
				}
			});
		};

		/** Drop unsent edits of a slide that is going away. */
		const cancelPending = (slideId: number) => {
			const timer = patchTimersRef.current.get(slideId);
			if (timer) clearTimeout(timer);
			patchTimersRef.current.delete(slideId);
			pendingPatchRef.current.delete(slideId);
			for (const [optionId, pending] of pendingOptionRef.current) {
				if (pending.slideId !== slideId) continue;
				const optionTimer = optionTimersRef.current.get(optionId);
				if (optionTimer) clearTimeout(optionTimer);
				optionTimersRef.current.delete(optionId);
				pendingOptionRef.current.delete(optionId);
			}
			refreshStatus();
		};

		const forgetSlide = (slideId: number) => {
			cancelPending(slideId);
			confirmedRef.current.delete(slideId);
			layersRef.current.delete(slideId);
			localRef.current.delete(slideId);
		};

		/** The server's order is authoritative after any structural change. */
		const applyOrder = (order: SlideOrderEntry[]) => {
			const ids = [...order].sort((a, b) => a.position - b.position).map((entry) => entry.id);
			const live = new Set(ids);
			for (const id of orderRef.current) if (!live.has(id)) forgetSlide(id);
			orderRef.current = ids.filter((id) => confirmedRef.current.has(id));
			syncPositions();
		};

		const receiveSlide = (slide: Slide) => {
			const index = orderRef.current.indexOf(slide.id);
			if (index < 0) return; // deleted meanwhile
			confirmedRef.current.set(slide.id, { ...slide, position: index + 1 } as Slide);
			recompute(slide.id);
		};

		const setSlideErrors = (slideId: number, next: FieldErrors) =>
			setErrors((all) => ({ ...all, [slideId]: { ...(all[slideId] ?? {}), ...next } }));

		const clearSlideErrors = (slideId: number, match: (key: string) => boolean) =>
			setErrors((all) => {
				const current = all[slideId];
				if (!current) return all;
				const kept = Object.fromEntries(Object.entries(current).filter(([key]) => !match(key)));
				if (Object.keys(kept).length === Object.keys(current).length) return all;
				return { ...all, [slideId]: kept };
			});

		const enqueueSlide = <T,>(slideId: number, task: () => Promise<T>): Promise<T> => {
			const previous = slideQueuesRef.current.get(slideId) ?? Promise.resolve();
			const next = previous.catch(() => undefined).then(task);
			slideQueuesRef.current.set(
				slideId,
				next.catch(() => undefined)
			);
			return next;
		};

		const enqueueDeck = <T,>(task: () => Promise<T>): Promise<T> => {
			const next = deckQueueRef.current.catch(() => undefined).then(task);
			deckQueueRef.current = next.catch(() => undefined);
			return next;
		};

		const refetchSlide = async (slideId: number) => {
			try {
				receiveSlide(await api.getSlide(deckId, slideId));
			} catch {
				// Leave the confirmed copy; the next save will tell.
			}
			bump();
		};

		/* ------------------------------ slide PATCH ----------------------------- */

		const sendPatch = async (slideId: number) => {
			patchQueuedRef.current.delete(slideId);
			const patch = pendingPatchRef.current.get(slideId);
			if (!patch || isEmptyPatch(patch) || !orderRef.current.includes(slideId)) return;
			pendingPatchRef.current.delete(slideId);
			const key = nextKey("patch");
			replaceLayer(slideId, PENDING_LAYER, { key, apply: (slide) => applySlidePatch(slide, patch) });
			bump();

			try {
				const slide = await track(() => api.updateSlide(deckId, slideId, patch));
				removeLayer(slideId, key);
				receiveSlide(slide);
				clearSlideErrors(slideId, (k) => PATCH_ERROR_PREFIXES.some((p) => k === p || k.startsWith(`${p}.`)));
			} catch (reason) {
				const error = toDeckApiError(reason);
				removeLayer(slideId, key);
				if (error.status === 422) {
					// Rolled back; the Editor shows the field errors next to the inputs.
					const fieldErrors = Object.keys(error.validationErrors).length ? error.validationErrors : { slide: [error.message] };
					setSlideErrors(slideId, fieldErrors);
					if (!Object.keys(error.validationErrors).length) toast.error(error.message);
				} else if (error.status === 409) {
					toast.info("This slide changed somewhere else, so it was reloaded.");
					await refetchSlide(slideId);
				} else if (error.code === "not_found") {
					forgetSlide(slideId);
					orderRef.current = orderRef.current.filter((id) => id !== slideId);
					syncPositions();
					toast.error("This slide no longer exists.");
				} else if (isTransient(error)) {
					// Keep the change and try again; anything typed since stays on top.
					const newer = pendingPatchRef.current.get(slideId);
					pendingPatchRef.current.set(slideId, newer ? mergePatches(patch, newer) : patch);
					if (!hasLayer(slideId, PENDING_LAYER)) addLayer(slideId, pendingLayer(slideId));
					failedRef.current = true;
					schedulePatch(slideId, RETRY_MS);
				} else {
					toast.error(error.message);
				}
			}
			bump();
		};

		const pendingLayer = (slideId: number): Layer => ({
			key: PENDING_LAYER,
			apply: (slide) => {
				const patch = pendingPatchRef.current.get(slideId);
				return patch ? applySlidePatch(slide, patch) : slide;
			},
		});

		const flushSlide = (slideId: number): Promise<void> => {
			const timer = patchTimersRef.current.get(slideId);
			if (timer) clearTimeout(timer);
			patchTimersRef.current.delete(slideId);
			refreshStatus();
			if (isEmptyPatch(pendingPatchRef.current.get(slideId))) {
				return (slideQueuesRef.current.get(slideId) ?? Promise.resolve()).then(() => undefined);
			}
			// A queued (not yet started) PATCH reads the pending patch when it runs.
			const queued = patchQueuedRef.current.get(slideId);
			if (queued) return queued;
			const task = enqueueSlide(slideId, () => sendPatch(slideId));
			patchQueuedRef.current.set(slideId, task);
			return task;
		};

		function schedulePatch(slideId: number, delay: number) {
			const existing = patchTimersRef.current.get(slideId);
			if (existing) clearTimeout(existing);
			patchTimersRef.current.set(
				slideId,
				setTimeout(() => {
					patchTimersRef.current.delete(slideId);
					void flushSlide(slideId);
				}, delay)
			);
			refreshStatus();
		}

		const patchSlide: DeckEditor["patchSlide"] = (slideId, patch, options) => {
			if (!confirmedRef.current.has(slideId) || isEmptyPatch(patch)) return;
			const previous = pendingPatchRef.current.get(slideId);
			pendingPatchRef.current.set(slideId, previous ? mergePatches(previous, patch) : patch);
			if (!hasLayer(slideId, PENDING_LAYER)) addLayer(slideId, pendingLayer(slideId));
			else recompute(slideId);
			// The author is fixing these fields: drop their old errors.
			const touched = new Set(patchErrorKeys(patch));
			clearSlideErrors(slideId, (key) => touched.has(key));
			bump();
			if (options?.immediate) {
				void flushSlide(slideId);
			} else {
				schedulePatch(slideId, AUTOSAVE_MS);
			}
		};

		/* -------------------------------- options -------------------------------- */

		const flushOption = (optionId: number): Promise<void> => {
			const timer = optionTimersRef.current.get(optionId);
			if (timer) clearTimeout(timer);
			optionTimersRef.current.delete(optionId);
			refreshStatus();
			const pending = pendingOptionRef.current.get(optionId);
			if (!pending) return Promise.resolve();
			pendingOptionRef.current.delete(optionId);
			const { slideId, input, waiters } = pending;
			const key = nextKey(`option-sent:${optionId}`);
			replaceLayer(slideId, `option:${optionId}`, { key, apply: (slide) => applyOptionInput(slide, optionId, input) });

			return enqueueSlide(slideId, async () => {
				try {
					const { option, slide } = await track(() => api.updateOption(deckId, slideId, optionId, input));
					removeLayer(slideId, key);
					receiveSlide(slide);
					clearSlideErrors(
						slideId,
						(k) => k.startsWith("options") || k === "label" || k === "payload" || k.startsWith("payload.") || k === "is_correct"
					);
					waiters.forEach((w) => w.resolve(option));
				} catch (reason) {
					const error = toDeckApiError(reason);
					removeLayer(slideId, key);
					if (error.status === 422) setSlideErrors(slideId, error.validationErrors);
					toast.error(error.message, { toastId: `option-${optionId}` });
					waiters.forEach((w) => w.reject(error));
				}
				bump();
			});
		};

		const optionsApiCache = new Map<number, OptionsApi>();

		const optionsApiFor = (slide: Slide): OptionsApi => {
			const cached = optionsApiCache.get(slide.id);
			if (cached) return cached;
			const slideId = slide.id;

			const run = async <T,>(task: () => Promise<T>, errorKey = "options"): Promise<T> => {
				try {
					const result = await track(task);
					clearSlideErrors(slideId, (k) => k.startsWith("options"));
					return result;
				} catch (reason) {
					const error = toDeckApiError(reason);
					if (error.status === 422) {
						setSlideErrors(slideId, Object.keys(error.validationErrors).length ? error.validationErrors : { [errorKey]: [error.message] });
					}
					toast.error(error.message, { toastId: `options-${slideId}` });
					throw error;
				}
			};

			const apiForSlide: OptionsApi = {
				min: DECK_LIMITS.optionMin[slide.type] ?? 0,
				max: DECK_LIMITS.optionMax[slide.type] ?? DECK_LIMITS.optionMax.default,

				add: (input) =>
					enqueueSlide(slideId, async () => {
						const { option, slide: next } = await run(() => api.addOption(deckId, slideId, input));
						receiveSlide(next);
						bump();
						return option;
					}),

				update: (optionId, input) => {
					const pending = pendingOptionRef.current.get(optionId) ?? { slideId, input: {}, waiters: [] };
					pending.input = { ...pending.input, ...input };
					pendingOptionRef.current.set(optionId, pending);
					const layerKey = `option:${optionId}`;
					if (!hasLayer(slideId, layerKey)) {
						addLayer(slideId, {
							key: layerKey,
							apply: (s) => {
								const current = pendingOptionRef.current.get(optionId);
								return current ? applyOptionInput(s, optionId, current.input) : s;
							},
						});
					} else {
						recompute(slideId);
					}
					bump();
					const existing = optionTimersRef.current.get(optionId);
					if (existing) clearTimeout(existing);
					optionTimersRef.current.set(
						optionId,
						setTimeout(() => {
							optionTimersRef.current.delete(optionId);
							void flushOption(optionId);
						}, AUTOSAVE_MS)
					);
					refreshStatus();
					return new Promise<SlideOption>((resolve, reject) => pending.waiters.push({ resolve, reject }));
				},

				remove: async (optionId) => {
					// A label still being typed goes first, so the delete is the last word.
					void flushOption(optionId);
					const key = nextKey(`option-removed:${optionId}`);
					addLayer(slideId, {
						key,
						apply: (s) =>
							({
								...s,
								options: s.options
									.filter((o) => o.id !== optionId)
									.map((o, index) => ({ ...o, position: index + 1 })),
							}) as Slide,
					});
					bump();
					await enqueueSlide(slideId, async () => {
						try {
							const next = await run(() => api.deleteOption(deckId, slideId, optionId));
							removeLayer(slideId, key);
							receiveSlide(next);
						} catch (error) {
							removeLayer(slideId, key);
							bump();
							throw error;
						}
						bump();
					});
				},

				setImage: (optionId, fileId) =>
					enqueueSlide(slideId, async () => {
						const option = await run(() => api.setOptionImage(deckId, slideId, optionId, fileId), "file_id");
						const base = confirmedRef.current.get(slideId);
						if (base) {
							confirmedRef.current.set(slideId, {
								...base,
								options: base.options.map((o) => (o.id === optionId ? option : o)),
							} as Slide);
							recompute(slideId);
						}
						bump();
						return option;
					}),

				reorder: async (orderedOptionIds) => {
					const key = nextKey("option-order");
					addLayer(slideId, { key, apply: (s) => reorderOptionsLocally(s, orderedOptionIds) });
					bump();
					await enqueueSlide(slideId, async () => {
						try {
							const next = await track(() => api.reorderOptions(deckId, slideId, orderedOptionIds));
							removeLayer(slideId, key);
							receiveSlide(next);
						} catch (reason) {
							const error = toDeckApiError(reason);
							removeLayer(slideId, key);
							if (error.status === 409) {
								toast.info("The options changed somewhere else, so they were reloaded.");
								await refetchSlide(slideId);
							} else {
								toast.error(error.message, { toastId: `options-${slideId}` });
							}
							bump();
							throw error;
						}
						bump();
					});
				},
			};

			optionsApiCache.set(slideId, apiForSlide);
			return apiForSlide;
		};

		/* --------------------------------- media --------------------------------- */

		const mediaApiCache = new Map<number, SlideMediaApi>();

		const mediaApiFor = (slideId: number): SlideMediaApi => {
			const cached = mediaApiCache.get(slideId);
			if (cached) return cached;

			const run = (field: "file_id" | "video_url", task: () => Promise<Slide>) =>
				enqueueSlide(slideId, async () => {
					try {
						const slide = await track(task);
						receiveSlide(slide);
						clearSlideErrors(slideId, (k) => k === "file_id" || k === "video_url" || k.startsWith("media"));
						bump();
					} catch (reason) {
						const error = toDeckApiError(reason);
						if (error.status === 422) {
							setSlideErrors(slideId, Object.keys(error.validationErrors).length ? error.validationErrors : { [field]: [error.message] });
						} else {
							toast.error(error.message);
						}
						throw error;
					}
				});

			const media: SlideMediaApi = {
				setFile: (fileId) => run("file_id", () => api.setSlideMediaFile(deckId, slideId, fileId)),
				setVideoUrl: (url) => run("video_url", () => api.setSlideVideoUrl(deckId, slideId, url)),
			};
			mediaApiCache.set(slideId, media);
			return media;
		};

		/* ------------------------------ structure ------------------------------ */

		const insertSlides = (slides: Slide[], order: SlideOrderEntry[]) => {
			for (const slide of slides) {
				confirmedRef.current.set(slide.id, slide);
				recompute(slide.id);
			}
			applyOrder(order);
			bump();
		};

		const structuralError = (reason: unknown) => {
			const error = toDeckApiError(reason);
			toast.error(error.message, { toastId: `deck-${error.code}` });
			return error;
		};

		const addSlide: DeckEditor["addSlide"] = (type, afterPosition, { select = true } = {}) =>
			enqueueDeck(async () => {
				try {
					const { slide, order } = await track(() =>
						api.addSlide(deckId, { type, after_position: afterPosition ?? null })
					);
					insertSlides([slide], order);
					if (select) setSelectedId(slide.id);
					return slide;
				} catch (reason) {
					structuralError(reason);
					return null;
				}
			});

		const addSlides: DeckEditor["addSlides"] = (input) =>
			enqueueDeck(async () => {
				try {
					const { slides, order } = await track(() => api.addSlidesBulk(deckId, input));
					insertSlides(slides, order);
					if (slides[0]) setSelectedId(slides[0].id);
					return slides;
				} catch (reason) {
					const error = toDeckApiError(reason);
					throw error;
				}
			});

		const duplicateSlide: DeckEditor["duplicateSlide"] = async (slideId) => {
			// The copy is made server-side, so it must include what was just typed.
			await flushSlide(slideId);
			return enqueueDeck(async () => {
				try {
					const { slide, order } = await track(() => api.duplicateSlide(deckId, slideId));
					insertSlides([slide], order);
					setSelectedId(slide.id);
					return slide;
				} catch (reason) {
					structuralError(reason);
					return null;
				}
			});
		};

		const deleteSlide: DeckEditor["deleteSlide"] = (slideId) => {
			const previousOrder = orderRef.current.slice();
			const index = previousOrder.indexOf(slideId);
			if (index < 0) return null;
			const snapshot = confirmedRef.current.get(slideId);
			cancelPending(slideId);

			orderRef.current = previousOrder.filter((id) => id !== slideId);
			syncPositions();
			const nextSelected = orderRef.current[index] ?? orderRef.current[index - 1] ?? null;
			setSelectedId((current) => (current === slideId ? nextSelected : current));
			bump();

			void enqueueDeck(async () => {
				await (slideQueuesRef.current.get(slideId) ?? Promise.resolve());
				try {
					const order = await track(() => api.deleteSlide(deckId, slideId));
					forgetSlide(slideId);
					applyOrder(order);
				} catch (reason) {
					const error = toDeckApiError(reason);
					if (error.code === "not_found") {
						forgetSlide(slideId);
					} else {
						structuralError(error);
						// Put it back where it was.
						if (snapshot && !orderRef.current.includes(slideId)) {
							const restored = orderRef.current.slice();
							restored.splice(Math.min(index, restored.length), 0, slideId);
							orderRef.current = restored;
							syncPositions();
						}
					}
				}
				bump();
			});
			return nextSelected;
		};

		const moveSlide: DeckEditor["moveSlide"] = (slideId, toIndex) => {
			const current = orderRef.current;
			const from = current.indexOf(slideId);
			const target = Math.max(0, Math.min(current.length - 1, toIndex));
			if (from < 0 || from === target) return;
			const rollback = current.slice();
			orderRef.current = moveItem(current, from, target);
			syncPositions();
			bump();

			// Several quick moves share one request: it reads the order when it runs.
			if (reorderQueuedRef.current) return;
			reorderQueuedRef.current = { rollback };
			void enqueueDeck(async () => {
				const batch = reorderQueuedRef.current;
				reorderQueuedRef.current = null;
				const entries = orderRef.current.map((id, index) => ({ id, position: index + 1 }));
				try {
					const order = await track(() => api.reorderSlides(deckId, entries));
					applyOrder(order);
				} catch (reason) {
					const error = structuralError(reason);
					if (error.status === 409) {
						await refreshStructure();
					} else if (batch) {
						orderRef.current = batch.rollback.filter((id) => confirmedRef.current.has(id));
						syncPositions();
					}
				}
				bump();
			});
		};

		/** Re-read the deck after a conflict; local edits (layers) stay on top. */
		const refreshStructure = async () => {
			try {
				const fresh = await api.getDeck(deckId);
				for (const slide of fresh.slides) {
					confirmedRef.current.set(slide.id, slide);
					recompute(slide.id);
				}
				applyOrder(fresh.slides.map((s) => ({ id: s.id, position: s.position })));
			} catch {
				// Keep what we have.
			}
		};

		/* ---------------------------------- deck --------------------------------- */

		const applySummary = (summary: DeckSummary, keepLocalTitle: boolean) => {
			const meta = metaRef.current;
			if (!meta) return;
			const { title, ...rest } = summary;
			metaRef.current = { ...meta, ...rest, title: keepLocalTitle ? meta.title : title, settings: resolveDeckSettings(summary.settings, api.product) };
			confirmedMetaRef.current = { title, settings: resolveDeckSettings(summary.settings, api.product) };
		};

		const saveTitle = async () => {
			titleTimerRef.current = null;
			const meta = metaRef.current;
			const confirmed = confirmedMetaRef.current;
			if (!meta || !confirmed) return;
			const title = meta.title.trim();
			if (!title || title === confirmed.title) {
				refreshStatus();
				return;
			}
			try {
				const summary = await track(() => api.updateDeck(deckId, { title }));
				applySummary(summary, metaRef.current?.title.trim() !== title);
			} catch (reason) {
				const error = toDeckApiError(reason);
				toast.error(error.message, { toastId: "deck-title" });
				if (metaRef.current && confirmedMetaRef.current) metaRef.current = { ...metaRef.current, title: confirmedMetaRef.current.title };
			}
			bump();
		};

		const setTitle: DeckEditor["setTitle"] = (title) => {
			if (!metaRef.current) return;
			metaRef.current = { ...metaRef.current, title };
			bump();
			if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
			titleTimerRef.current = title.trim() ? setTimeout(() => void saveTitle(), AUTOSAVE_MS) : null;
			refreshStatus();
		};

		const commitTitle: DeckEditor["commitTitle"] = () => {
			if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
			titleTimerRef.current = null;
			const meta = metaRef.current;
			// An empty title is not allowed: go back to the saved one.
			if (meta && !meta.title.trim() && confirmedMetaRef.current) {
				metaRef.current = { ...meta, title: confirmedMetaRef.current.title };
				bump();
			}
			void saveTitle();
		};

		const updateSettings: DeckEditor["updateSettings"] = async (patch) => {
			const meta = metaRef.current;
			if (!meta) return;
			const before = meta.settings;
			const optimistic = { ...before } as Record<string, unknown>;
			const defaults = resolveDeckSettings(null, api.product) as unknown as Record<string, unknown>;
			for (const [key, value] of Object.entries(patch)) optimistic[key] = value === null ? defaults[key] : value;
			metaRef.current = { ...meta, settings: optimistic as unknown as DeckSettings };
			bump();
			try {
				const summary = await track(() => api.updateDeck(deckId, { settings: patch }));
				applySummary(summary, !!titleTimerRef.current);
			} catch (reason) {
				const error = toDeckApiError(reason);
				if (metaRef.current) metaRef.current = { ...metaRef.current, settings: before };
				throw error;
			} finally {
				bump();
			}
		};

		const setVisibility: DeckEditor["setVisibility"] = async (visibility) => {
			const meta = metaRef.current;
			if (!meta || meta.visibility === visibility) return;
			const before = meta.visibility;
			metaRef.current = { ...meta, visibility };
			bump();
			try {
				const summary = await track(() => api.updateDeck(deckId, { visibility }));
				applySummary(summary, !!titleTimerRef.current);
			} catch (reason) {
				const error = toDeckApiError(reason);
				if (metaRef.current) metaRef.current = { ...metaRef.current, visibility: before };
				throw error;
			} finally {
				bump();
			}
		};

		const flushAll: DeckEditor["flushAll"] = async () => {
			if (titleTimerRef.current) {
				clearTimeout(titleTimerRef.current);
				await saveTitle();
			}
			const optionIds = [...pendingOptionRef.current.keys()];
			const slideIds = new Set([...pendingPatchRef.current.keys(), ...patchTimersRef.current.keys()]);
			await Promise.allSettled([
				...optionIds.map((id) => flushOption(id)),
				...[...slideIds].map((id) => flushSlide(id)),
			]);
			await Promise.allSettled([...slideQueuesRef.current.values(), deckQueueRef.current]);
		};

		const init = (deck: Deck) => {
			const { slides, ...meta } = deck;
			metaRef.current = { ...meta, settings: resolveDeckSettings(meta.settings, api.product) };
			confirmedMetaRef.current = { title: meta.title, settings: resolveDeckSettings(meta.settings, api.product) };
			confirmedRef.current = new Map(slides.map((s) => [s.id, s]));
			localRef.current = new Map(slides.map((s) => [s.id, s]));
			layersRef.current = new Map();
			orderRef.current = [...slides].sort((a, b) => a.position - b.position).map((s) => s.id);
			syncPositions();
			bump();
		};

		return {
			init,
			patchSlide,
			optionsApiFor,
			mediaApiFor,
			addSlide,
			addSlides,
			duplicateSlide,
			deleteSlide,
			moveSlide,
			setTitle,
			commitTitle,
			updateSettings,
			setVisibility,
			flushAll,
		};
	}, [api, deckId]);

	// Load (and reload) the deck.
	useEffect(() => {
		const controller = new AbortController();
		setLoadState("loading");
		setLoadError(null);
		api
			.getDeck(deckId, controller.signal)
			.then((deck) => {
				if (controller.signal.aborted) return;
				editor.init(deck);
				const preferred = preferredRef.current;
				const usePreferred =
					preferred !== null &&
					appliedPreferredRef.current !== preferred &&
					deck.slides.some((s) => s.id === preferred);
				if (preferred !== null) appliedPreferredRef.current = preferred;
				setSelectedId((current) =>
					usePreferred
						? preferred
						: current !== null && deck.slides.some((s) => s.id === current)
							? current
							: (deck.slides[0]?.id ?? null)
				);
				setLoadState("ready");
			})
			.catch((reason) => {
				const error = toDeckApiError(reason);
				if (controller.signal.aborted || error.code === "cancelled") return;
				setLoadError(error);
				setLoadState("error");
			});
		return () => controller.abort();
	}, [api, deckId, editor, loadKey]);

	// Leaving with unsaved work: warn, and send what is queued on unmount.
	useEffect(() => {
		const onBeforeUnload = (event: BeforeUnloadEvent) => {
			const pending =
				busyRef.current > 0 ||
				patchTimersRef.current.size > 0 ||
				optionTimersRef.current.size > 0 ||
				!!titleTimerRef.current;
			if (!pending) return;
			void editor.flushAll();
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => {
			window.removeEventListener("beforeunload", onBeforeUnload);
			void editor.flushAll();
		};
	}, [editor]);

	const deck = useMemo<Deck | null>(() => {
		void version;
		const meta = metaRef.current;
		if (!meta) return null;
		const slides = orderRef.current
			.map((id) => localRef.current.get(id))
			.filter((slide): slide is Slide => !!slide);
		return { ...meta, slideCount: slides.length, slides };
	}, [version]);

	// ?slide changed while the editor is open (same deck): select it if it exists.
	useEffect(() => {
		if (!deck || preferredSlideId === null || appliedPreferredRef.current === preferredSlideId) return;
		appliedPreferredRef.current = preferredSlideId;
		if (deck.slides.some((s) => s.id === preferredSlideId)) setSelectedId(preferredSlideId);
	}, [deck, preferredSlideId]);

	// The selected slide vanished (deleted elsewhere, reload): pick a neighbour.
	useEffect(() => {
		if (!deck || selectedId === null) return;
		if (!deck.slides.some((s) => s.id === selectedId)) setSelectedId(deck.slides[0]?.id ?? null);
	}, [deck, selectedId]);

	return {
		loadState,
		loadError,
		deck,
		selectedId,
		select: setSelectedId,
		saveStatus,
		errorsFor: (slideId) => errors[slideId],
		patchSlide: editor.patchSlide,
		optionsApiFor: editor.optionsApiFor,
		mediaApiFor: editor.mediaApiFor,
		addSlide: editor.addSlide,
		addSlides: editor.addSlides,
		duplicateSlide: editor.duplicateSlide,
		deleteSlide: editor.deleteSlide,
		moveSlide: editor.moveSlide,
		setTitle: editor.setTitle,
		commitTitle: editor.commitTitle,
		updateSettings: editor.updateSettings,
		setVisibility: editor.setVisibility,
		flushAll: editor.flushAll,
		reload,
	};
}
