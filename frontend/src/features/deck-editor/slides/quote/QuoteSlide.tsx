"use client";

import { Quote as QuoteIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EditorProps, ParticipantProps, PresenterProps } from "../types";
import { TextAreaField, TextField } from "../shared";
import { ContentPhone, ContentStage, FitText, PreviewHint, contentSize, fieldError, type ContentVariant } from "../shared/contentKit";

// `quote`: a large quote (config.text, multi-line ≤ 500) with an optional
// attribution (≤ 120). The slide title is not shown; the quote is the slide.

const MAX_TEXT = 500;
const MAX_ATTRIBUTION = 120;

export function QuoteEditor({ slide, onChange, errors, disabled }: EditorProps<"quote">) {
	return (
		<div className="flex flex-col gap-4">
			<TextAreaField
				label="Quote"
				value={slide.config.text ?? ""}
				onChange={(value) => onChange({ config: { text: value } })}
				debounceMs={400}
				maxLength={MAX_TEXT}
				rows={5}
				placeholder="The words to quote. Line breaks are kept."
				error={fieldError(errors, "text")}
				disabled={disabled}
			/>
			<TextField
				label="Attribution (optional)"
				value={slide.config.attribution ?? ""}
				onChange={(value) => onChange({ config: { attribution: value.trim() === "" ? null : value } })}
				debounceMs={400}
				maxLength={MAX_ATTRIBUTION}
				showCount
				placeholder="e.g. Ada Lovelace"
				error={fieldError(errors, "attribution")}
				disabled={disabled}
			/>
		</div>
	);
}

function QuoteView({
	text,
	attribution,
	variant,
	preview,
}: {
	text: string;
	attribution: string | null;
	variant: ContentVariant;
	preview: boolean;
}) {
	const value = text.trim();
	// Long quotes read better a step smaller before FitText has to shrink them.
	const long = [...value].length > 220;
	return (
		<FitText
			variant={variant}
			fitKey={`${value}\u0000${attribution}`}
			className={cn(variant === "phone" && "flex-1 justify-center")}
		>
			<figure className="m-0 mx-auto flex max-w-[34em] flex-col items-center gap-[0.6em] text-center">
				<QuoteIcon
					aria-hidden
					className="h-[2.2em] w-[2.2em] shrink-0"
					style={{ color: "var(--deck-primary)" }}
					strokeWidth={1.75}
				/>
				<blockquote className="m-0">
					<p
						className="m-0 whitespace-pre-line font-semibold leading-snug [overflow-wrap:anywhere]"
						style={{ fontSize: long ? contentSize(variant, "subtitle") : contentSize(variant, "lead") }}
					>
						{value !== "" ? value : preview ? <PreviewHint>Your quote</PreviewHint> : null}
					</p>
				</blockquote>
				{attribution ? (
					<figcaption
						className="font-medium [overflow-wrap:anywhere]"
						style={{ fontSize: contentSize(variant, "body"), color: "var(--deck-text-muted)" }}
					>
						<span aria-hidden>— </span>
						{attribution}
					</figcaption>
				) : null}
			</figure>
		</FitText>
	);
}

export function QuotePresenter({ run, theme, mode }: PresenterProps<"quote">) {
	return (
		<ContentStage theme={theme}>
			<QuoteView text={run.config.text ?? ""} attribution={run.config.attribution} variant="stage" preview={mode === "preview"} />
		</ContentStage>
	);
}

export function QuoteParticipant({ run, theme }: ParticipantProps<"quote">) {
	return (
		<ContentPhone theme={theme} position={run.position}>
			<QuoteView text={run.config.text ?? ""} attribution={run.config.attribution} variant="phone" preview={false} />
		</ContentPhone>
	);
}
