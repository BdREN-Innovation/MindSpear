"use client";

import type { EditorProps, ParticipantProps, PresenterProps } from "../types";
import {
	ContentPhone,
	ContentStage,
	ContentTitle,
	FitText,
	PreviewHint,
	SlideTitleField,
	type ContentVariant,
} from "../heading/contentKit";
import { ListItemsEditor } from "./ListItemsEditor";

// bullets / numbered share everything but the marker (NumberedSlideType
// extends BulletsSlideType; numbering is rendered here, not stored).

type ListKey = "bullets" | "numbered";
// Unions of the two prop types (the prop types are invariant in their key):
// both slide types share ListConfig, so one component serves either.
type ListEditorProps = EditorProps<"bullets"> | EditorProps<"numbered">;
type ListPresenterProps = PresenterProps<"bullets"> | PresenterProps<"numbered">;
type ListParticipantProps = ParticipantProps<"bullets"> | ParticipantProps<"numbered">;

export function createListEditor(ordered: boolean) {
	const noun = ordered ? "step" : "point";
	function ListEditor({ slide, onChange, errors, disabled }: ListEditorProps) {
		return (
			<div className="flex flex-col gap-4">
				<SlideTitleField<ListKey>
					label="Title (optional)"
					placeholder={ordered ? "e.g. How it works" : "e.g. Key takeaways"}
					title={slide.title}
					onChange={onChange}
					errors={errors}
					disabled={disabled}
				/>
				<ListItemsEditor
					items={slide.config.items ?? []}
					onCommit={(items) => onChange({ config: { items } })}
					ordered={ordered}
					noun={noun}
					errors={errors}
					disabled={disabled}
				/>
			</div>
		);
	}
	ListEditor.displayName = ordered ? "NumberedEditor" : "BulletsEditor";
	return ListEditor;
}

/** Fewer items get bigger type; FitText shrinks whatever still overflows. */
function itemScale(count: number): number {
	if (count <= 3) return 1.3;
	if (count <= 5) return 1.15;
	if (count <= 8) return 1;
	if (count <= 12) return 0.88;
	return 0.78;
}

const PREVIEW_ITEMS = ["First point", "Second point", "Third point"];

export function ListView({
	title,
	items,
	ordered,
	variant,
	preview,
}: {
	title: string | null;
	items: string[];
	ordered: boolean;
	variant: ContentVariant;
	preview: boolean;
}) {
	// Empty entries are allowed while authoring; the audience never sees blank rows.
	const visible = items.map((text) => text.trim()).filter((text) => text !== "");
	const placeholder = preview && visible.length === 0;
	const shown = placeholder ? PREVIEW_ITEMS : visible;
	// Long lists flow into two columns on the wide stage.
	const columns = variant === "stage" && shown.length > 8 ? 2 : 1;
	const scale = variant === "stage" ? itemScale(shown.length) : 1.0625;
	const Tag = ordered ? "ol" : "ul";

	return (
		<FitText variant={variant} fitKey={`${title}\u0000${shown.join("\u0000")}`}>
			<div className="flex w-full flex-col gap-[0.8em] text-left">
				<ContentTitle title={title} variant={variant} align="left" />
				{shown.length > 0 ? (
					<Tag
						role="list"
						className="m-0 list-none p-0"
						style={{ fontSize: `${scale}em`, columnCount: columns, columnGap: "2.5em" }}
					>
						{shown.map((text, index) => (
							<li
								key={index}
								className="mb-[0.55em] flex break-inside-avoid items-start gap-[0.65em] leading-[1.3] [overflow-wrap:anywhere]"
							>
								{ordered ? (
									// Visible text (not aria-hidden): with list-style none the number is how screen readers hear the order.
									<span
										className="mt-[0.05em] flex h-[1.5em] min-w-[1.5em] shrink-0 items-center justify-center rounded-full px-[0.35em] text-[0.8em] font-bold tabular-nums"
										style={{ background: "var(--deck-primary)", color: "var(--deck-on-primary)" }}
									>
										{index + 1}
									</span>
								) : (
									<span
										aria-hidden
										className="mt-[0.47em] h-[0.38em] w-[0.38em] shrink-0 rounded-full"
										style={{ background: "var(--deck-primary)" }}
									/>
								)}
								<span className="min-w-0 flex-1">{placeholder ? <PreviewHint>{text}</PreviewHint> : text}</span>
							</li>
						))}
					</Tag>
				) : null}
			</div>
		</FitText>
	);
}

export function createListPresenter(ordered: boolean) {
	function ListPresenter({ run, theme, mode }: ListPresenterProps) {
		return (
			<ContentStage theme={theme} align="stretch">
				<ListView title={run.title} items={run.config.items ?? []} ordered={ordered} variant="stage" preview={mode === "preview"} />
			</ContentStage>
		);
	}
	ListPresenter.displayName = ordered ? "NumberedPresenter" : "BulletsPresenter";
	return ListPresenter;
}

export function createListParticipant(ordered: boolean) {
	function ListParticipant({ run, theme }: ListParticipantProps) {
		return (
			<ContentPhone theme={theme} position={run.position}>
				<ListView title={run.title} items={run.config.items ?? []} ordered={ordered} variant="phone" preview={false} />
			</ContentPhone>
		);
	}
	ListParticipant.displayName = ordered ? "NumberedParticipant" : "BulletsParticipant";
	return ListParticipant;
}

export const BulletsEditor = createListEditor(false);
export const BulletsPresenter = createListPresenter(false);
export const BulletsParticipant = createListParticipant(false);
