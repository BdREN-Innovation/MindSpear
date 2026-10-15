"use client";

import type { ComponentType, CSSProperties } from "react";
import type { RichTextNode, SlideTypeKey } from "@/features/deck/types";
import type { EditorProps, ParticipantProps, PresenterProps } from "./types";

// TODO(slide type agents): fallback Editor / Presenter / Participant used by
// every slides/<folder>/index.ts until that type ships its real components.
// They only read props, never call the API, so every shell renders today.

/** Best-effort main text of a run/slide config for the placeholders. */
function configText(config: unknown): string[] {
	const c = (config ?? {}) as Record<string, unknown>;
	const lines: string[] = [];
	if (typeof c.subtitle === "string") lines.push(c.subtitle);
	if (typeof c.text === "string") lines.push(c.text);
	if (Array.isArray(c.items)) lines.push(...c.items.filter((item): item is string => typeof item === "string"));
	if (typeof c.attribution === "string") lines.push(`— ${c.attribution}`);
	if (typeof c.caption === "string") lines.push(c.caption);
	return lines.filter((line) => line.trim() !== "");
}

function bodyText(nodes: RichTextNode[] | undefined): string {
	return (nodes ?? []).map((node) => node.text ?? bodyText(node.content)).join(" ").trim();
}

function TodoBadge({ label }: { label: string }) {
	return (
		<span className="inline-flex items-center rounded-full border border-dashed border-current px-2 py-0.5 text-xs font-medium opacity-70">
			TODO · {label}
		</span>
	);
}

export interface PlaceholderComponents<K extends SlideTypeKey> {
	Editor: ComponentType<EditorProps<K>>;
	Presenter: ComponentType<PresenterProps<K>>;
	Participant: ComponentType<ParticipantProps<K>>;
}

/** Placeholder components for a type (label shown in the TODO badge). */
export function createPlaceholders<K extends SlideTypeKey>(label: string): PlaceholderComponents<K> {
	function PlaceholderEditor({ slide }: EditorProps<K>) {
		return (
			<div className="flex flex-col gap-3 rounded-lg border border-dashed border-gray-4 p-4 text-sm text-dark-4 dark:text-dark-6">
				<TodoBadge label={`${label} editor`} />
				<p>The content editor for this slide type is not built yet.</p>
				{slide.options.length > 0 && (
					<ul className="list-disc pl-5">
						{slide.options.map((option) => (
							<li key={option.id}>{option.label || <em>Empty option</em>}</li>
						))}
					</ul>
				)}
			</div>
		);
	}

	function PlaceholderPresenter({ run, aggregate, theme }: PresenterProps<K>) {
		const lines = configText(run.config);
		const body = run.body ? bodyText(run.body.content) : "";
		const total = (aggregate as { total_responses?: number } | null)?.total_responses ?? null;
		return (
			<div
				className="flex h-full w-full flex-col items-center justify-center gap-6 p-8 text-center"
				style={{ ...(theme.cssVars as CSSProperties), background: "var(--deck-bg)", color: "var(--deck-text)" }}
			>
				<TodoBadge label={`${label} presenter`} />
				<h2 className="text-3xl font-bold md:text-5xl">{run.title || label}</h2>
				{body && <p className="max-w-3xl text-lg" style={{ color: "var(--deck-text-muted)" }}>{body}</p>}
				{lines.map((line, index) => (
					<p key={index} className="max-w-3xl text-xl" style={{ color: "var(--deck-text-muted)" }}>
						{line}
					</p>
				))}
				{run.options.length > 0 && (
					<ul className="grid w-full max-w-3xl gap-2">
						{run.options.map((option) => (
							<li
								key={option.id}
								className="rounded-lg border px-4 py-3 text-left text-lg"
								style={{ borderColor: "var(--deck-border)", background: "var(--deck-surface)" }}
							>
								{option.label || "—"}
							</li>
						))}
					</ul>
				)}
				{total !== null && <p className="text-sm" style={{ color: "var(--deck-text-muted)" }}>{total} responses</p>}
			</div>
		);
	}

	function PlaceholderParticipant({ run, theme }: ParticipantProps<K>) {
		const lines = configText(run.config);
		return (
			<div
				className="flex min-h-full w-full flex-col gap-4 p-5"
				style={{ ...(theme.cssVars as CSSProperties), background: "var(--deck-bg)", color: "var(--deck-text)" }}
			>
				<TodoBadge label={`${label} participant`} />
				<h2 className="text-2xl font-semibold">{run.title || label}</h2>
				{lines.map((line, index) => (
					<p key={index} style={{ color: "var(--deck-text-muted)" }}>
						{line}
					</p>
				))}
				{run.accepts_answers && (
					<p role="status" className="text-sm" style={{ color: "var(--deck-text-muted)" }}>
						Answering this slide type is not available yet.
					</p>
				)}
			</div>
		);
	}

	PlaceholderEditor.displayName = `PlaceholderEditor(${label})`;
	PlaceholderPresenter.displayName = `PlaceholderPresenter(${label})`;
	PlaceholderParticipant.displayName = `PlaceholderParticipant(${label})`;

	return { Editor: PlaceholderEditor, Presenter: PlaceholderPresenter, Participant: PlaceholderParticipant };
}
