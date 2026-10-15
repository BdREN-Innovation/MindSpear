"use client";

import { cn } from "@/lib/utils";
import type { EditorProps, ParticipantProps, PresenterProps } from "../types";
import { TextField } from "../shared";
import { ContentPhone, ContentStage, FitText, PreviewHint, contentSize, fieldError, type ContentVariant } from "../heading/contentKit";

// `big_text`: one big phrase for section breaks (config.text, single line ≤ 80).
// The slide title is not shown; the phrase is the slide.

const MAX_TEXT = 80;

export function BigTextEditor({ slide, onChange, errors, disabled }: EditorProps<"big_text">) {
	return (
		<TextField
			label="Big text"
			hint="One short phrase, shown as large as the screen allows. Good for section breaks."
			value={slide.config.text ?? ""}
			onChange={(value) => onChange({ config: { text: value } })}
			debounceMs={400}
			maxLength={MAX_TEXT}
			showCount
			placeholder="e.g. Part 2: Ideas"
			error={fieldError(errors, "text")}
			disabled={disabled}
		/>
	);
}

/** Shorter phrases get bigger type; FitText still shrinks anything that would wrap off the slide. */
function lengthScale(text: string): number {
	const length = [...text].length;
	if (length <= 12) return 1.25;
	if (length <= 28) return 1;
	if (length <= 50) return 0.8;
	return 0.66;
}

function BigTextView({ text, variant, preview }: { text: string; variant: ContentVariant; preview: boolean }) {
	const value = text.trim();
	const Tag = variant === "stage" ? "h1" : "h2";
	return (
		<FitText
			variant={variant}
			fitKey={value}
			className={cn(variant === "phone" && "flex-1 justify-center")}
			contentClassName="text-center"
		>
			<Tag
				className="m-0 font-extrabold leading-[1.05] tracking-tight [overflow-wrap:anywhere]"
				style={{ fontSize: `calc(${contentSize(variant, "display")} * ${lengthScale(value)})` }}
			>
				{value !== "" ? value : preview ? <PreviewHint>Big text</PreviewHint> : null}
			</Tag>
		</FitText>
	);
}

export function BigTextPresenter({ run, theme, mode }: PresenterProps<"big_text">) {
	return (
		<ContentStage theme={theme}>
			<BigTextView text={run.config.text ?? ""} variant="stage" preview={mode === "preview"} />
		</ContentStage>
	);
}

export function BigTextParticipant({ run, theme }: ParticipantProps<"big_text">) {
	return (
		<ContentPhone theme={theme} position={run.position}>
			<BigTextView text={run.config.text ?? ""} variant="phone" preview={false} />
		</ContentPhone>
	);
}
