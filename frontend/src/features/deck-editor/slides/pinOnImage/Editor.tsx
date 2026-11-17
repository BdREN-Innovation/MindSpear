"use client";

import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import type { EditorProps } from "../types";
import { MediaSlot, NumberField } from "../shared";
import { QuestionField } from "../shared/editorKit";

// pin_on_image editor (plan §5.4): the question; the image is mandatory (session start
// refuses the slide without one, or when its width/height are unknown, since
// the heatmap needs the aspect ratio), plus the pin cap 1..10.

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

function Notice({ children }: { children: ReactNode }) {
	return (
		<p
			role="note"
			className="m-0 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
		>
			<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
			<span>{children}</span>
		</p>
	);
}

export function PinOnImageEditor({ slide, onChange, media, errors, disabled }: EditorProps<"pin_on_image">) {
	const file = slide.media;
	const hasSize = !!file?.width && !!file?.height;
	const aspect = hasSize ? `${file!.width} / ${file!.height}` : "16 / 9";
	const badType = !!file?.mime && !IMAGE_MIMES.includes(file.mime.toLowerCase());
	const mediaError = errors?.file_id ?? errors?.media ?? errors?.["config.media"] ?? null;

	return (
		<div className="flex flex-col gap-5">
			<QuestionField<"pin_on_image">
				title={slide.title}
				onChange={onChange}
				errors={errors}
				disabled={disabled}
				placeholder="Where would you like the new café?"
			/>

			<div className="flex flex-col gap-2">
				<MediaSlot
					accept="image"
					media={file}
					onPickFile={(fileId) => media.setFile(fileId)}
					onDetach={() => media.setFile(null)}
					label="Image (required)"
					aspect={aspect}
					error={mediaError}
					hint="Participants tap this image to drop pins. JPG, PNG, GIF or WebP."
					disabled={disabled}
				/>
				{!file ? <Notice>Add an image: a session can&apos;t start until this slide has one.</Notice> : null}
				{file && !hasSize ? (
					<Notice>This image&apos;s size is unknown, so pins can&apos;t be placed on it. Upload it again or choose another image.</Notice>
				) : null}
				{file && badType ? <Notice>Use a JPG, PNG, GIF or WebP image.</Notice> : null}
			</div>

			<NumberField
				label="Pins per participant"
				value={slide.config.max_pins_per_participant ?? 1}
				min={1}
				max={10}
				debounceMs={400}
				hint="1 to 10. With 1, tapping again moves the pin."
				error={errors?.["config.max_pins_per_participant"]}
				disabled={disabled}
				onChange={(value) => {
					if (value !== null) onChange({ config: { max_pins_per_participant: value } });
				}}
			/>
		</div>
	);
}
