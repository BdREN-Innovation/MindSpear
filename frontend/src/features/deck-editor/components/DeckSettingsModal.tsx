"use client";

import { useEffect, useState } from "react";
import { Globe, Lock } from "lucide-react";
import { Modal } from "@/components/ui";
import { isDeckApiError } from "@/features/deck/api/errors";
import { getDeckTheme } from "@/features/deck/theme";
import type { DeckProduct, DeckQaSort, DeckSettings, DeckSettingsPatch, DeckVisibility } from "@/features/deck/types";
import { RadioCardField, SegmentedField, SelectField, ToggleField, type ChoiceOption, type RadioCardOption } from "../slides/shared";
import { ThemeGrid } from "./inspector/DesignTab";
import { GET_READY_CHOICES, timeLimitOptions } from "./inspector/SettingsTab";
import { productCopy } from "@/features/deck/productCopy";

// Deck-wide settings (backend DeckRequest → DeckSettings): default_time_limit,
// get_ready_seconds, theme, show_qr_sidebar, default_qa_sort, plus the deck's
// visibility (private / public in Discover), saved on its own. The timer
// defaults only seed slides added later; existing slides keep their own.
// Quiz decks have no Q&A slides, so the Q&A order is Quest-only; their
// get-ready countdown defaults to 5 s (resolveDeckSettings(…, 'quiz')).

export interface DeckSettingsModalProps {
	open: boolean;
	/** Default quest. */
	product?: DeckProduct;
	settings: DeckSettings;
	visibility: DeckVisibility;
	onClose(): void;
	onSave(patch: DeckSettingsPatch): Promise<void>;
	onSaveVisibility(visibility: DeckVisibility): Promise<void>;
}

const QA_SORTS: ChoiceOption<DeckQaSort>[] = [
	{ value: "top", label: "Most upvoted" },
	{ value: "newest", label: "Newest" },
];

const GET_READY_OPTIONS: ChoiceOption<number>[] = [{ value: 0, label: "Off" }, ...GET_READY_CHOICES];

const visibilities = (noun: string): RadioCardOption<DeckVisibility>[] => [
	{ value: "private", label: "Only me", icon: Lock, description: `Only you can see and present this ${noun}.` },
	{
		value: "public",
		label: "Public in Discover",
		icon: Globe,
		description: "Anyone signed in can find it in Discover, preview it and copy it to their own library.",
	},
];

export function DeckSettingsModal({
	open,
	product = "quest",
	settings,
	visibility,
	onClose,
	onSave,
	onSaveVisibility,
}: DeckSettingsModalProps) {
	const copy = productCopy(product);
	const quiz = product === "quiz";
	const [draft, setDraft] = useState<DeckSettings>(settings);
	const [sharing, setSharing] = useState<DeckVisibility>(visibility);
	const [errors, setErrors] = useState<Record<string, string[]>>({});
	const [formError, setFormError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	// Start from the saved values every time the modal opens.
	useEffect(() => {
		if (open) {
			setDraft(settings);
			setSharing(visibility);
			setErrors({});
			setFormError(null);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	const set = <K extends keyof DeckSettings>(key: K, value: DeckSettings[K]) => setDraft((d) => ({ ...d, [key]: value }));

	const save = async () => {
		const patch: DeckSettingsPatch = {};
		(Object.keys(draft) as (keyof DeckSettings)[]).forEach((key) => {
			if (draft[key] !== settings[key]) (patch as Record<string, unknown>)[key] = draft[key];
		});
		const visibilityChanged = sharing !== visibility;
		if (Object.keys(patch).length === 0 && !visibilityChanged) {
			onClose();
			return;
		}
		setSaving(true);
		setErrors({});
		setFormError(null);
		try {
			if (Object.keys(patch).length > 0) await onSave(patch);
			if (visibilityChanged) await onSaveVisibility(sharing);
			onClose();
		} catch (error) {
			if (isDeckApiError(error) && error.status === 422) {
				const fieldErrors = error.fieldErrors("settings");
				setErrors(fieldErrors);
				if (!Object.keys(fieldErrors).length) setFormError(error.message);
			} else {
				setFormError((error as Error)?.message || "The settings could not be saved.");
			}
		} finally {
			setSaving(false);
		}
	};

	const getReadyOptions = GET_READY_OPTIONS.some((o) => o.value === draft.get_ready_seconds)
		? GET_READY_OPTIONS
		: [...GET_READY_OPTIONS, { value: draft.get_ready_seconds, label: `${draft.get_ready_seconds} seconds` }].sort((a, b) => a.value - b.value);

	return (
		<Modal
			title={`${copy.Noun} settings`}
			open={open}
			onClose={saving ? undefined : onClose}
			width={{ xs: "95%", sm: "90%", md: "90%", lg: 980, xl: 1040, xxl: 1080 }}
			footer={
				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={onClose}
						disabled={saving}
						className="min-h-11 rounded-lg border border-stroke px-4 text-sm font-medium text-dark hover:bg-gray-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 dark:border-stroke-dark dark:text-white dark:hover:bg-dark-3"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={save}
						disabled={saving}
						className="min-h-12 rounded-lg bg-primary px-5 text-sm font-semibold text-dark hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 disabled:opacity-60"
					>
						{saving ? "Saving…" : "Save settings"}
					</button>
				</div>
			}
		>
			<form
				// Two columns on wide screens (settings | theme), so it fits without scrolling.
				className="grid gap-x-8 gap-y-5 py-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]"
				onSubmit={(event) => {
					event.preventDefault();
					void save();
				}}
			>
				<div className="flex flex-col gap-5">
					<fieldset className="flex flex-col gap-2">
						<legend className="mb-1 text-sm font-semibold text-dark dark:text-white">Sharing</legend>
						<RadioCardField<DeckVisibility>
							label={`Who can find this ${copy.noun}`}
							hideLabel
							hint={sharing === "public" ? `Your sessions and results stay private, and copies never change your ${copy.noun}.` : undefined}
							value={sharing}
							options={visibilities(copy.noun)}
							error={errors.visibility}
							onChange={setSharing}
						/>
					</fieldset>

					<fieldset className="flex flex-col gap-2">
						<legend className="mb-1 text-sm font-semibold text-dark dark:text-white">Defaults for new slides</legend>
						<div className="grid gap-3 sm:grid-cols-2">
							<SelectField<number>
								label="Time limit"
								value={draft.default_time_limit ?? 0}
								options={timeLimitOptions(draft.default_time_limit)}
								error={errors.default_time_limit}
								onChange={(value) => set("default_time_limit", value === 0 ? null : value)}
							/>
							<SelectField<number>
								label="Get-ready countdown"
								value={draft.get_ready_seconds}
								options={getReadyOptions}
								error={errors.get_ready_seconds}
								onChange={(value) => set("get_ready_seconds", value)}
							/>
						</div>
						<p className="text-xs text-dark-5 dark:text-dark-6">
							For question slides you add from now on (the countdown runs before {quiz ? "answering" : "voting"} opens). Existing slides keep
							their own.
						</p>
					</fieldset>

					<fieldset className="flex flex-col gap-3">
						<legend className="mb-1 text-sm font-semibold text-dark dark:text-white">Presenting</legend>
						<ToggleField
							label="Show the QR code sidebar"
							description="The join code and QR code sit next to every slide."
							checked={draft.show_qr_sidebar}
							error={errors.show_qr_sidebar}
							onChange={(on) => set("show_qr_sidebar", on)}
						/>
						{quiz ? null : (
							<SegmentedField<DeckQaSort>
								label="Default Q&A order"
								hint="How audience questions are sorted on new Q&A slides."
								value={draft.default_qa_sort}
								options={QA_SORTS}
								error={errors.default_qa_sort}
								onChange={(value) => set("default_qa_sort", value)}
							/>
						)}
					</fieldset>
				</div>

				<fieldset className="flex flex-col gap-2">
					<legend className="mb-1 text-sm font-semibold text-dark dark:text-white">
						Theme <span className="font-normal text-dark-5">· {getDeckTheme(draft.theme).label}</span>
					</legend>
					<ThemeGrid value={draft.theme} onChange={(key) => set("theme", key)} disabled={saving} columns={3} />
					{errors.theme ? (
						<p role="alert" className="text-xs font-medium text-[#B42318]">
							{errors.theme[0]}
						</p>
					) : null}
				</fieldset>

				{formError ? (
					<p role="alert" className="rounded-lg border border-red-light-3 bg-red-light-5 px-3 py-2 text-sm text-[#B42318] lg:col-span-2">
						{formError}
					</p>
				) : null}
			</form>
		</Modal>
	);
}
