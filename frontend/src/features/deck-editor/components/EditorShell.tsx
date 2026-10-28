"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { authoringApiFor } from "@/features/deck/api/authoringApi";
import { getDeckTheme } from "@/features/deck/theme";
import type { DeckProduct, Slide, SlideTypeKey } from "@/features/deck/types";
import { getSlideType } from "../slideRegistry";
import { CenterCanvas } from "./CenterCanvas";
import { DeckSettingsModal } from "./DeckSettingsModal";
import { EditorHeader } from "./EditorHeader";
import { DeleteSlideDialog, EditorLoading, FeatureDisabledPage, LoadErrorPage } from "./EditorStates";
import { GenerateSlidesModal } from "./GenerateSlidesModal";
import { InspectorPanel } from "./InspectorPanel";
import { PreviewOverlay } from "./PreviewOverlay";
import { productCopy } from "./productCopy";
import { SlidePicker } from "./SlidePicker";
import { SlideRail } from "./SlideRail";
import { useDeckEditor } from "./useDeckEditor";

// The v2 deck editor (Quest plan §5.1 / §5.3): header, slide rail, canvas,
// inspector. Product-parameterised: /quests/[id]/edit and /quizzes/[id]/edit
// share it; the product picks the API (/quests/v2 or /quizzes), the slide
// types the picker offers, the Settings tab fields (quiz scoring) and copy.

export interface EditorShellProps {
	deckId: string;
	product?: DeckProduct;
	/** Slide to select once the deck loads (?slide=<id>); unknown ids fall back to the first slide. */
	initialSlideId?: number | null;
}

/** Single-key shortcuts must not fire while the author is typing. */
function isTypingTarget(element: HTMLElement | null): boolean {
	if (!element) return false;
	if (element.isContentEditable || element.closest('[contenteditable="true"]')) return true;
	const tag = element.tagName;
	if (tag === "TEXTAREA" || tag === "SELECT") return true;
	if (tag === "INPUT") {
		const type = (element as HTMLInputElement).type;
		return !["button", "checkbox", "radio", "submit", "reset", "color", "file"].includes(type);
	}
	return element.getAttribute("role") === "textbox";
}

export function EditorShell({ deckId, product = "quest", initialSlideId = null }: EditorShellProps) {
	const api = authoringApiFor(product);
	const editor = useDeckEditor(deckId, api, { preferredSlideId: initialSlideId });
	const {
		deck,
		selectedId,
		select,
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
	} = editor;
	const router = useRouter();
	const copy = productCopy(product);

	const [pickerOpen, setPickerOpen] = useState(false);
	const [aiOpen, setAiOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [previewOpen, setPreviewOpen] = useState(false);
	const [deleteId, setDeleteId] = useState<number | null>(null);
	const [adding, setAdding] = useState(false);
	const [presenting, setPresenting] = useState(false);
	const [announcement, setAnnouncement] = useState("");

	const buttonsRef = useRef(new Map<number, HTMLButtonElement>());
	const pendingFocusRef = useRef<number | "add" | null>(null);
	const addButtonRef = useRef<HTMLButtonElement | null>(null);

	const slides = useMemo(() => deck?.slides ?? [], [deck]);
	const selectedIndex = slides.findIndex((s) => s.id === selectedId);
	const selected: Slide | null = selectedIndex >= 0 ? slides[selectedIndex] : null;
	const theme = useMemo(() => getDeckTheme(deck?.settings.theme), [deck?.settings.theme]);

	const registerButton = useCallback((slideId: number, element: HTMLButtonElement | null) => {
		if (element) buttonsRef.current.set(slideId, element);
		else buttonsRef.current.delete(slideId);
	}, []);

	/** Focus a thumbnail once it is rendered (after add / duplicate / delete / jump). */
	const focusSlide = useCallback(
		(slideId: number | null) => {
			if (slideId !== null) select(slideId);
			pendingFocusRef.current = slideId ?? "add";
		},
		[select]
	);

	useEffect(() => {
		const target = pendingFocusRef.current;
		if (target === null) return;
		if (target === "add") {
			pendingFocusRef.current = null;
			addButtonRef.current?.focus();
			return;
		}
		const element = buttonsRef.current.get(target);
		if (!element) return;
		pendingFocusRef.current = null;
		element.focus();
		element.scrollIntoView({ block: "nearest" });
	}, [slides, selectedId]);

	// Keep the selected thumbnail visible when selection changes by other means.
	useEffect(() => {
		if (selectedId !== null) buttonsRef.current.get(selectedId)?.scrollIntoView({ block: "nearest" });
	}, [selectedId]);

	const announce = (message: string) => setAnnouncement(message);

	const onPick = useCallback(
		async (type: SlideTypeKey) => {
			setPickerOpen(false);
			setAdding(true);
			const slide = await addSlide(type, selected?.position ?? null);
			setAdding(false);
			if (slide) {
				focusSlide(slide.id);
				announce(`${getSlideType(type)?.label ?? "Slide"} added as slide ${slide.position}.`);
			}
		},
		[addSlide, focusSlide, selected?.position]
	);

	const onDuplicate = useCallback(
		async (slideId: number) => {
			const slide = await duplicateSlide(slideId);
			if (slide) {
				focusSlide(slide.id);
				announce(`Slide duplicated as slide ${slide.position}.`);
			}
		},
		[duplicateSlide, focusSlide]
	);

	const onRequestDelete = useCallback((slideId: number) => setDeleteId(slideId), []);

	const onConfirmDelete = () => {
		if (deleteId === null) return;
		const number = slides.findIndex((s) => s.id === deleteId) + 1;
		const next = deleteSlide(deleteId);
		setDeleteId(null);
		focusSlide(next);
		announce(`Slide ${number} deleted.`);
	};

	const onMove = useCallback(
		(slideId: number, toIndex: number) => {
			moveSlide(slideId, toIndex);
			announce(`Slide moved to position ${toIndex + 1}.`);
		},
		[moveSlide]
	);

	const onFocusSlide = useCallback((slideId: number) => focusSlide(slideId), [focusSlide]);
	const onSelect = useCallback((slideId: number) => select(slideId), [select]);
	const openPicker = useCallback(() => setPickerOpen(true), []);

	const onPresent = async () => {
		setPresenting(true);
		await flushAll();
		router.push(copy.presentHref(deckId));
	};

	// Editor shortcuts (plan §5.3). Refs keep the listener stable.
	const stateRef = useRef({ slides, selectedId, blocked: false });
	stateRef.current = {
		slides,
		selectedId,
		blocked: pickerOpen || aiOpen || settingsOpen || previewOpen || deleteId !== null,
	};
	const actionsRef = useRef({ onDuplicate, onMove, onRequestDelete, openPicker, onFocusSlide });
	actionsRef.current = { onDuplicate, onMove, onRequestDelete, openPicker, onFocusSlide };

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const { slides: list, selectedId: current, blocked } = stateRef.current;
			const actions = actionsRef.current;
			if (blocked || event.defaultPrevented || event.isComposing) return;
			const target = event.target as HTMLElement | null;
			if (target?.closest('[role="dialog"], .ant-modal-wrap') || isTypingTarget(target)) return;
			const index = list.findIndex((s) => s.id === current);
			const mod = event.metaKey || event.ctrlKey;

			if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "d") {
				event.preventDefault();
				if (current !== null) void actions.onDuplicate(current);
				return;
			}
			if (mod && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
				if (current === null || index < 0) return;
				event.preventDefault();
				const to = index + (event.key === "ArrowUp" ? -1 : 1);
				if (to >= 0 && to < list.length) {
					actions.onMove(current, to);
					actions.onFocusSlide(current);
				}
				return;
			}
			if (mod || event.altKey) return;
			// Single keys stay out of the inspector, where the type editors own the keyboard.
			if (target?.closest("[data-deck-inspector]")) return;

			if (event.key === "Delete" || event.key === "Backspace") {
				if (current === null) return;
				event.preventDefault();
				actions.onRequestDelete(current);
			} else if (event.key === "n" || event.key === "N") {
				event.preventDefault();
				actions.openPicker();
			} else if (/^[1-9]$/.test(event.key)) {
				const slide = list[Number(event.key) - 1];
				if (!slide) return;
				event.preventDefault();
				actions.onFocusSlide(slide.id);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	if (editor.blocked) return <FeatureDisabledPage error={editor.blocked} product={product} />;
	if (editor.loadState === "loading" && !deck) return <EditorLoading product={product} />;
	if (editor.loadState === "error" && editor.loadError)
		return <LoadErrorPage error={editor.loadError} onRetry={editor.reload} product={product} />;
	if (!deck) return <EditorLoading product={product} />;

	const deleteTarget = deleteId !== null ? slides.find((s) => s.id === deleteId) : undefined;

	return (
		<div className="flex h-full w-full flex-col bg-gray-2 dark:bg-dark">
			<EditorHeader
				title={deck.title}
				saveStatus={editor.saveStatus}
				backHref={copy.libraryHref}
				product={product}
				canPresent={slides.length > 0}
				presenting={presenting}
				visibility={deck.visibility}
				onTitleChange={setTitle}
				onTitleCommit={commitTitle}
				onRetrySave={() => void flushAll()}
				onPreview={() => setPreviewOpen(true)}
				onOpenSettings={() => setSettingsOpen(true)}
				onPresent={onPresent}
			/>

			<p className="border-b border-yellow-dark/30 bg-yellow-light-4 px-4 py-2 text-xs text-dark lg:hidden">
				The {copy.noun} editor is built for larger screens. Use a laptop or desktop for the best experience.
			</p>

			<div className="flex min-h-0 flex-1 overflow-x-auto">
				<SlideRail
					slides={slides}
					selectedId={selectedId}
					theme={theme}
					onSelect={onSelect}
					onFocusSlide={onFocusSlide}
					onMove={onMove}
					onDuplicate={onDuplicate}
					onDelete={onRequestDelete}
					onAdd={openPicker}
					registerButton={registerButton}
					addButtonRef={addButtonRef}
				/>
				<CenterCanvas
					product={product}
					slide={selected}
					index={selectedIndex}
					total={slides.length}
					theme={theme}
					onAdd={openPicker}
					onDuplicate={onDuplicate}
					onDelete={onRequestDelete}
					onMove={onMove}
				/>
				<InspectorPanel
					product={product}
					deck={deck}
					slide={selected}
					errors={selected ? editor.errorsFor(selected.id) : undefined}
					onPatch={patchSlide}
					options={selected ? optionsApiFor(selected) : null}
					media={selected ? mediaApiFor(selected.id) : null}
					onUpdateSettings={updateSettings}
					onOpenDeckSettings={() => setSettingsOpen(true)}
				/>
			</div>

			<p className="sr-only" role="status" aria-live="polite">
				{announcement}
			</p>

			<SlidePicker
				open={pickerOpen}
				product={product}
				busy={adding}
				onClose={() => setPickerOpen(false)}
				onPick={onPick}
				onGenerate={() => {
					setPickerOpen(false);
					setAiOpen(true);
				}}
			/>

			<GenerateSlidesModal
				open={aiOpen}
				product={product}
				onClose={() => setAiOpen(false)}
				afterPosition={selected?.position ?? null}
				onAddSlides={addSlides}
				onAdded={(added) => {
					toast.success(`${added.length} ${added.length === 1 ? "slide" : "slides"} added.`);
					if (added[0]) focusSlide(added[0].id);
				}}
			/>

			<DeckSettingsModal
				open={settingsOpen}
				product={product}
				settings={deck.settings}
				visibility={deck.visibility}
				onClose={() => setSettingsOpen(false)}
				onSave={updateSettings}
				onSaveVisibility={setVisibility}
			/>

			<DeleteSlideDialog
				open={deleteId !== null}
				slideNumber={deleteTarget ? slides.indexOf(deleteTarget) + 1 : 0}
				slideTitle={deleteTarget?.title?.trim() ?? ""}
				onCancel={() => setDeleteId(null)}
				onConfirm={onConfirmDelete}
			/>

			{previewOpen ? (
				<PreviewOverlay
					product={product}
					slides={slides}
					startIndex={Math.max(0, selectedIndex)}
					theme={theme}
					title={deck.title}
					onClose={(lastId) => {
						setPreviewOpen(false);
						if (lastId !== null) select(lastId);
					}}
				/>
			) : null}
		</div>
	);
}
