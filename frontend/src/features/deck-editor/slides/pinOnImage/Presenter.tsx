/* eslint-disable @next/next/no-img-element -- My Files URLs on arbitrary hosts; the box must match the image's own aspect. */
"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Flame, ImageIcon, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PresenterProps } from "../types";
import { PresenterStage, ResponseCount, SlideTitle, usePrefersReducedMotion } from "../shared";
import { HeatmapCanvas } from "../shared/HeatmapCanvas";
import { fallbackTitle } from "../shared/labels";
import { pointKeys } from "../shared/pointMath";
import { TIMER_CHIP_CLEARANCE } from "../shared/stageLayout";

// pin_on_image presenter (plan §6.3): the image fitted into the stage at its
// own aspect (snapshot media width/height), with either the pins (latest 150,
// fading in as they arrive) or a client-side gaussian heatmap of every pin.
// The Pins / Heatmap switch is live only: in 'preview' (editor canvas, slide
// rail thumbnails) the stage sits inside a <button>, so no controls render.

type View = "pins" | "heatmap";

export function PinOnImagePresenter({ run, aggregate, mode }: PresenterProps<"pin_on_image">) {
	const [view, setView] = useState<View>("pins");
	const interactive = mode === "live";
	const reduceMotion = usePrefersReducedMotion();
	const media = run.config.media ?? null;
	const aspect = media?.width && media?.height ? media.width / media.height : 16 / 9;
	const pins = useMemo(() => aggregate?.pins ?? [], [aggregate]);
	const keys = useMemo(() => pointKeys(pins), [pins]);
	const totalPins = aggregate?.total_pins ?? 0;

	return (
		<PresenterStage>
			{/* Right padding keeps the shell's timer chip area (top-right ~220×56 px) clear. */}
			<div className="flex items-start justify-between gap-[2cqw]" style={TIMER_CHIP_CLEARANCE}>
				<SlideTitle title={run.title} fallback={fallbackTitle("pin_on_image")} size="md" />
				<div className="flex shrink-0 items-center gap-[1.5cqw]">
					<ResponseCount count={aggregate?.total_responses ?? 0} />
					{interactive ? (
						<div
							role="group"
							aria-label="Results view"
							className="flex rounded-full p-[0.3cqw]"
							style={{ background: "var(--deck-surface-muted)" }}
						>
							{(
								[
									["pins", "Pins", MapPin],
									["heatmap", "Heatmap", Flame],
								] as const
							).map(([value, label, Icon]) => (
								<button
									key={value}
									type="button"
									aria-pressed={view === value}
									onClick={() => setView(value)}
									className="flex min-h-11 items-center gap-[0.5cqw] rounded-full px-[1.2cqw] font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[color:var(--deck-focus)]"
									style={{
										fontSize: "clamp(0.75rem, 1.3cqw, 1.1rem)",
										background: view === value ? "var(--deck-primary)" : "transparent",
										color: view === value ? "var(--deck-on-primary)" : "var(--deck-text-muted)",
									}}
								>
									<Icon className="h-[1.1em] w-[1.1em]" aria-hidden />
									{label}
								</button>
							))}
						</div>
					) : null}
				</div>
			</div>

			{/* Size container: the image box is the largest `aspect` rectangle that fits. */}
			<div className="relative min-h-0 flex-1" style={{ containerType: "size" }}>
				<div
					className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[1cqw]"
					style={{
						width: `min(100cqw, calc(100cqh * ${aspect}))`,
						aspectRatio: `${aspect}`,
						background: "var(--deck-surface-muted)",
					}}
				>
					{media ? (
						<img src={media.url} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none object-fill" />
					) : (
						<div className="absolute inset-0 flex flex-col items-center justify-center gap-[1cqw]" style={{ color: "var(--deck-text-muted)" }}>
							<ImageIcon className="h-[6cqw] w-[6cqw]" aria-hidden />
							<p className="m-0 font-medium" style={{ fontSize: "clamp(0.875rem, 1.8cqw, 1.5rem)" }}>
								Add an image to this slide
							</p>
						</div>
					)}

					{view === "heatmap" ? (
						<HeatmapCanvas points={pins} density={aggregate?.density} total={totalPins} aspect={aspect} variant="heat" opacity={0.8} />
					) : (
						pins.map((pin, index) => (
							<motion.span
								key={keys[index]}
								aria-hidden
								className="absolute rounded-full"
								initial={reduceMotion ? false : { opacity: 0, scale: 0.2 }}
								animate={{ opacity: 1, scale: 1 }}
								transition={{ duration: reduceMotion ? 0 : 0.35, ease: "easeOut" }}
								style={{
									left: `${pin.x}%`,
									top: `${pin.y}%`,
									width: "1.5cqw",
									height: "1.5cqw",
									minWidth: 8,
									minHeight: 8,
									marginLeft: "-0.75cqw",
									marginTop: "-0.75cqw",
									background: "var(--deck-primary)",
									border: "0.25cqw solid #fff",
									boxShadow: "0 0.2cqw 0.6cqw rgba(0,0,0,0.35)",
								}}
							/>
						))
					)}

					{media && totalPins === 0 ? (
						<p
							role="status"
							className={cn("absolute bottom-[2cqw] left-1/2 m-0 -translate-x-1/2 rounded-full px-[2cqw] py-[0.8cqw] font-medium")}
							style={{ fontSize: "clamp(0.875rem, 1.6cqw, 1.4rem)", background: "rgba(17,25,40,0.7)", color: "#fff" }}
						>
							Waiting for pins…
						</p>
					) : null}
				</div>
			</div>

			<p className="sr-only" aria-live="polite">
				{totalPins === 1 ? "1 pin placed" : `${totalPins} pins placed`}
				{view === "heatmap" ? ", heatmap view" : ""}
			</p>
		</PresenterStage>
	);
}
