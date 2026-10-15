"use client";

import type { ReactNode } from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunMedia, VideoConfig } from "@/features/deck/types";
import type { EditorProps, ParticipantProps, PresenterProps } from "../types";
import { MediaSlot } from "../shared";
import { ContentPhone, ContentStage, ContentTitle, SlideTitleField, contentSize, type ContentVariant } from "../heading/contentKit";

// `video`: EITHER a YouTube / Vimeo link OR an mp4 from My Files, never both
// (VideoSlideType). The server derives a privacy-friendly embed_url
// (youtube-nocookie.com / player.vimeo.com) from the link; we only ever
// embed that, and only if it still has exactly that shape.

/** The two embed URL shapes VideoSlideType::parseVideoUrl() produces. */
const SAFE_EMBED_URL = /^https:\/\/(?:www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}|player\.vimeo\.com\/video\/\d{1,12}(?:\?h=[0-9a-f]{6,32})?)$/;

export function VideoEditor({ slide, onChange, media, errors, disabled }: EditorProps<"video">) {
	return (
		<div className="flex flex-col gap-4">
			<SlideTitleField<"video">
				label="Title (optional)"
				placeholder="Shown above the video"
				title={slide.title}
				onChange={onChange}
				errors={errors}
				disabled={disabled}
			/>
			{/* Link and upload are exclusive: the media API clears one when the other is set. */}
			<MediaSlot
				accept="video"
				label="Video"
				media={slide.media}
				videoUrl={slide.config.video_url}
				embedUrl={slide.config.embed_url && SAFE_EMBED_URL.test(slide.config.embed_url) ? slide.config.embed_url : null}
				onPickFile={(fileId) => media.setFile(fileId)}
				onVideoUrl={(url) => media.setVideoUrl(url)}
				onDetach={() => media.setFile(null)}
				error={errors?.video_url ?? errors?.file_id ?? errors?.media ?? null}
				hint="Paste a YouTube or Vimeo link, or use an mp4 from My Files. Adding one replaces the other."
				disabled={disabled}
			/>
		</div>
	);
}

type VideoSource =
	| { kind: "file"; media: RunMedia }
	| { kind: "embed"; url: string; provider: VideoConfig["video_provider"] }
	| { kind: "none" };

function videoSource(config: VideoConfig): VideoSource {
	if (config.media?.url) return { kind: "file", media: config.media };
	if (config.embed_url && SAFE_EMBED_URL.test(config.embed_url)) {
		return { kind: "embed", url: config.embed_url, provider: config.video_provider };
	}
	return { kind: "none" };
}

function providerLabel(source: VideoSource): string {
	if (source.kind === "file") return "Video";
	if (source.kind === "embed") return source.provider === "vimeo" ? "Vimeo video" : "YouTube video";
	return "Add a video";
}

function VideoView({
	title,
	config,
	variant,
	preview,
}: {
	title: string | null;
	config: VideoConfig;
	variant: ContentVariant;
	preview: boolean;
}) {
	const stage = variant === "stage";
	const source = videoSource(config);
	const label = title && title.trim() !== "" ? title : providerLabel(source);
	// Stage: the largest 16:9 box that fits under the title.
	const frameClass = stage ? "aspect-video max-h-full max-w-full h-full" : "aspect-video w-full";

	let player: ReactNode = null;
	if (preview || source.kind === "none") {
		// Editor canvas / thumbnails: a static poster, so no player or third-party frame loads per thumbnail.
		player =
			source.kind === "none" && !preview ? null : (
				<div
					className={cn(frameClass, "flex flex-col items-center justify-center gap-[0.5em] rounded-[0.5em]")}
					style={{ background: source.kind === "none" ? "var(--deck-surface)" : "#0B0F19", color: source.kind === "none" ? "var(--deck-text-muted)" : "#FFFFFF" }}
				>
					<span
						aria-hidden
						className="flex h-[2.6em] w-[2.6em] items-center justify-center rounded-full"
						style={{ background: source.kind === "none" ? "var(--deck-surface-muted)" : "var(--deck-primary)" }}
					>
						<Play className="ml-[0.12em] h-[1.3em] w-[1.3em]" fill="currentColor" />
					</span>
					<span style={{ fontSize: contentSize(variant, "small") }}>{providerLabel(source)}</span>
				</div>
			);
	} else if (source.kind === "file") {
		player = (
			<video
				src={source.media.url}
				controls
				playsInline
				preload="metadata"
				className={cn(frameClass, "rounded-[0.5em] bg-black object-contain")}
				aria-label={label}
			>
				{/* My Files mp4s have no caption track yet; the element is required by a11y lint. */}
				<track kind="captions" />
			</video>
		);
	} else {
		player = (
			<iframe
				src={source.url}
				title={label}
				className={cn(frameClass, "rounded-[0.5em] border-0 bg-black")}
				allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
				allowFullScreen
				loading="lazy"
				referrerPolicy="strict-origin-when-cross-origin"
			/>
		);
	}

	return (
		<div
			className={cn("flex w-full flex-col items-center", stage ? "min-h-0 flex-1 gap-[1.2cqw]" : "gap-3")}
			style={stage ? { fontSize: "clamp(12px, 2.5cqw, 72px)" } : undefined}
		>
			<ContentTitle title={title} variant={variant} className={stage ? "shrink-0" : undefined} />
			{player ? <div className={cn("flex w-full items-center justify-center", stage && "min-h-0 flex-1")}>{player}</div> : null}
		</div>
	);
}

export function VideoPresenter({ run, theme, mode }: PresenterProps<"video">) {
	return (
		<ContentStage theme={theme}>
			<VideoView title={run.title} config={run.config} variant="stage" preview={mode === "preview"} />
		</ContentStage>
	);
}

export function VideoParticipant({ run, theme }: ParticipantProps<"video">) {
	return (
		<ContentPhone theme={theme} position={run.position}>
			<VideoView title={run.title} config={run.config} variant="phone" preview={false} />
		</ContentPhone>
	);
}
