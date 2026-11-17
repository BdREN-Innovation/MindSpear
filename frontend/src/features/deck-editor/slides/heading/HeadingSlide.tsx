"use client";

import { cn } from "@/lib/utils";
import type { EditorProps, ParticipantProps, PresenterProps } from "../types";
import { TextField } from "../shared";
import {
	ContentPhone,
	ContentStage,
	FitText,
	PreviewHint,
	SlideTitleField,
	contentSize,
	fieldError,
	type ContentVariant,
} from "../shared/contentKit";

// `heading`: the slide title as a big headline plus an optional subtitle
// (config.subtitle ≤ 250). The headline is the slide's own `title`, so the
// rail, thumbnails and canvas always agree (HeadingSlideType).

const MAX_SUBTITLE = 250;

export function HeadingEditor({ slide, onChange, errors, disabled }: EditorProps<"heading">) {
	return (
		<div className="flex flex-col gap-4">
			<SlideTitleField<"heading">
				label="Heading"
				placeholder="e.g. Welcome to the workshop"
				title={slide.title}
				onChange={onChange}
				errors={errors}
				disabled={disabled}
			/>
			<TextField
				label="Subtitle (optional)"
				value={slide.config.subtitle ?? ""}
				onChange={(value) => onChange({ config: { subtitle: value.trim() === "" ? null : value } })}
				debounceMs={400}
				maxLength={MAX_SUBTITLE}
				showCount
				placeholder="A line under the heading"
				error={fieldError(errors, "subtitle")}
				disabled={disabled}
			/>
		</div>
	);
}

function HeadingView({
	title,
	subtitle,
	variant,
	preview,
}: {
	title: string | null;
	subtitle: string | null;
	variant: ContentVariant;
	preview: boolean;
}) {
	const hasTitle = !!title && title.trim() !== "";
	const Tag = variant === "stage" ? "h1" : "h2";
	return (
		<FitText
			variant={variant}
			fitKey={`${title}\u0000${subtitle}`}
			className={cn(variant === "phone" && "flex-1 justify-center")}
			contentClassName="flex flex-col items-center gap-[0.55em] text-center"
		>
			<Tag className="m-0 font-bold leading-[1.1] [overflow-wrap:anywhere]" style={{ fontSize: contentSize(variant, "hero") }}>
				{hasTitle ? title : preview ? <PreviewHint>Your heading</PreviewHint> : null}
			</Tag>
			<span aria-hidden className="block h-[0.18em] w-[2.4em] rounded-full" style={{ background: "var(--deck-primary)" }} />
			{subtitle ? (
				<p
					className="m-0 max-w-[40em] whitespace-pre-line leading-snug [overflow-wrap:anywhere]"
					style={{ fontSize: contentSize(variant, "subtitle"), color: "var(--deck-text-muted)" }}
				>
					{subtitle}
				</p>
			) : null}
		</FitText>
	);
}

export function HeadingPresenter({ run, theme, mode }: PresenterProps<"heading">) {
	return (
		<ContentStage theme={theme}>
			<HeadingView title={run.title} subtitle={run.config.subtitle} variant="stage" preview={mode === "preview"} />
		</ContentStage>
	);
}

export function HeadingParticipant({ run, theme }: ParticipantProps<"heading">) {
	return (
		<ContentPhone theme={theme} position={run.position}>
			<HeadingView title={run.title} subtitle={run.config.subtitle} variant="phone" preview={false} />
		</ContentPhone>
	);
}
