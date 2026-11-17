/* eslint-disable @next/next/no-img-element -- My Files URLs are arbitrary hosts; next/image needs a fixed list. */
"use client";

import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunMedia } from "@/features/deck/types";
import type { EditorProps, ParticipantProps, PresenterProps } from "../types";
import { MediaSlot, TextField } from "../shared";
import { ContentPhone, ContentStage, ContentTitle, SlideTitleField, contentSize, fieldError, type ContentVariant } from "../shared/contentKit";

// `image`: one My Files image (slides.media_file_id → snapshot config.media)
// with an optional caption (≤ 200) and alt text (≤ 250). The image is shown
// whole (object-fit: contain), never cropped.

const MAX_CAPTION = 200;
const MAX_ALT = 250;

export function ImageEditor({ slide, onChange, media, errors, disabled }: EditorProps<"image">) {
	return (
		<div className="flex flex-col gap-4">
			<SlideTitleField<"image">
				label="Title (optional)"
				placeholder="Shown above the image"
				title={slide.title}
				onChange={onChange}
				errors={errors}
				disabled={disabled}
			/>
			<MediaSlot
				accept="image"
				label="Image"
				media={slide.media}
				onPickFile={(fileId) => media.setFile(fileId)}
				onDetach={() => media.setFile(null)}
				error={errors?.file_id ?? errors?.media ?? null}
				disabled={disabled}
			/>
			<TextField
				label="Caption (optional)"
				value={slide.config.caption ?? ""}
				onChange={(value) => onChange({ config: { caption: value.trim() === "" ? null : value } })}
				debounceMs={400}
				maxLength={MAX_CAPTION}
				showCount
				placeholder="Shown under the image"
				error={fieldError(errors, "caption")}
				disabled={disabled}
			/>
			<TextField
				label="Alt text"
				hint="Describe the image for people who can't see it. Leave empty if it's only decoration."
				value={slide.config.alt ?? ""}
				onChange={(value) => onChange({ config: { alt: value.trim() === "" ? null : value } })}
				debounceMs={400}
				maxLength={MAX_ALT}
				showCount
				placeholder="e.g. Bar chart of sales rising each quarter"
				error={fieldError(errors, "alt")}
				disabled={disabled}
			/>
		</div>
	);
}

function ImageView({
	title,
	image,
	caption,
	alt,
	variant,
	preview,
}: {
	title: string | null;
	image: RunMedia | null;
	caption: string | null;
	alt: string | null;
	variant: ContentVariant;
	preview: boolean;
}) {
	const stage = variant === "stage";
	return (
		<div
			className={cn("flex w-full flex-col items-center", stage ? "min-h-0 flex-1 gap-[1.2cqw]" : "gap-3")}
			style={stage ? { fontSize: "clamp(12px, 2.5cqw, 72px)" } : undefined}
		>
			<ContentTitle title={title} variant={variant} className={stage ? "shrink-0" : undefined} />
			<figure className={cn("m-0 flex w-full flex-col items-center", stage ? "min-h-0 flex-1 gap-[0.5em]" : "gap-2")}>
				{image ? (
					<img
						src={image.url}
						alt={alt ?? ""}
						width={image.width ?? undefined}
						height={image.height ?? undefined}
						draggable={false}
						className={cn(
							"block object-contain",
							stage ? "min-h-0 w-full flex-1 rounded-[0.4cqw]" : "h-auto max-h-[70svh] w-full rounded-xl"
						)}
					/>
				) : preview ? (
					<div
						className={cn(
							"flex w-full flex-col items-center justify-center gap-[0.4em] rounded-[0.5em] border-2 border-dashed",
							stage ? "min-h-0 flex-1" : "aspect-video"
						)}
						style={{ borderColor: "var(--deck-border)", color: "var(--deck-text-muted)", background: "var(--deck-surface)" }}
					>
						<ImageIcon aria-hidden className="h-[2.4em] w-[2.4em]" strokeWidth={1.5} />
						<span style={{ fontSize: contentSize(variant, "small") }}>Add an image</span>
					</div>
				) : null}
				{caption ? (
					<figcaption
						className="max-w-[48em] shrink-0 text-center leading-snug [overflow-wrap:anywhere]"
						style={{ fontSize: stage ? contentSize(variant, "small") : contentSize(variant, "body"), color: "var(--deck-text-muted)" }}
					>
						{caption}
					</figcaption>
				) : null}
			</figure>
		</div>
	);
}

export function ImagePresenter({ run, theme, mode }: PresenterProps<"image">) {
	return (
		<ContentStage theme={theme}>
			<ImageView
				title={run.title}
				image={run.config.media ?? null}
				caption={run.config.caption}
				alt={run.config.alt}
				variant="stage"
				preview={mode === "preview"}
			/>
		</ContentStage>
	);
}

export function ImageParticipant({ run, theme }: ParticipantProps<"image">) {
	return (
		<ContentPhone theme={theme} position={run.position}>
			<ImageView
				title={run.title}
				image={run.config.media ?? null}
				caption={run.config.caption}
				alt={run.config.alt}
				variant="phone"
				preview={false}
			/>
		</ContentPhone>
	);
}
