"use client";

import { useMemo } from "react";
import type { ParagraphConfig, RichTextDoc } from "@/features/deck/types";
import type { ParticipantProps, PresenterProps } from "../types";
import { ContentPhone, ContentStage, ContentTitle, FitText, PreviewHint, contentSize, type ContentVariant } from "../shared/contentKit";
import { canonicalBody, isBodyEmpty, normaliseBody } from "./body";
import { RichText } from "./RichText";

// `paragraph`: rich text from slides.body (run body), laid out by
// config.align (left / center / right; a block's own textAlign wins) and
// config.text_size. Rendered from the structured body via React elements.

const TEXT_SCALE: Record<ParagraphConfig["text_size"], number> = { small: 0.82, medium: 1, large: 1.25 };

function ParagraphView({
	title,
	body,
	config,
	variant,
	preview,
}: {
	title: string | null;
	body: RichTextDoc | null;
	config: ParagraphConfig;
	variant: ContentVariant;
	preview: boolean;
}) {
	const doc = useMemo(() => normaliseBody(body), [body]);
	const fitKey = useMemo(() => `${title}\u0000${config.text_size}\u0000${canonicalBody(doc)}`, [title, config.text_size, doc]);
	const align = config.align ?? "left";
	const scale = TEXT_SCALE[config.text_size] ?? 1;
	const empty = isBodyEmpty(doc);

	return (
		<FitText variant={variant} fitKey={fitKey}>
			<div className="flex w-full flex-col gap-[0.7em]" style={{ textAlign: align }}>
				<ContentTitle title={title} variant={variant} align={align} />
				{empty ? (
					preview ? (
						<p className="m-0" style={{ fontSize: contentSize(variant, "body") }}>
							<PreviewHint>Your text</PreviewHint>
						</p>
					) : null
				) : (
					<RichText
						doc={doc}
						// The editor canvas is a picture of the slide: no clickable links there.
						interactive={!preview}
						style={{ fontSize: `calc(${contentSize(variant, "body")} * ${scale})` }}
					/>
				)}
			</div>
		</FitText>
	);
}

export function ParagraphPresenter({ run, theme, mode }: PresenterProps<"paragraph">) {
	return (
		<ContentStage theme={theme} align="stretch">
			<ParagraphView title={run.title} body={run.body} config={run.config} variant="stage" preview={mode === "preview"} />
		</ContentStage>
	);
}

export function ParagraphParticipant({ run, theme }: ParticipantProps<"paragraph">) {
	return (
		<ContentPhone theme={theme} position={run.position}>
			<ParagraphView title={run.title} body={run.body} config={run.config} variant="phone" preview={false} />
		</ContentPhone>
	);
}
