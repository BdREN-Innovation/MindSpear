"use client";

import { useSyncExternalStore } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2 } from "lucide-react";
import type { EditorProps, ParticipantProps, PresenterProps } from "../types";
import { ToggleField } from "../shared";
import { ContentPhone, ContentStage, SlideTitleField, contentSize, fieldError } from "../shared/contentKit";

// `qr_code`: the session's join QR code, plus the code and address when
// config.show_join_code. The code is session data (PresenterProps.session),
// never slide data; the editor preview shows a sample. On phones the
// audience has already joined, so they see "You're in!" instead of a QR.

/** A code from the v2 alphabet (no O/0/I/1) so the sample looks real. */
const SAMPLE_CODE = "ABC234";
const DEFAULT_TITLE = "Scan to join";

export function QrCodeEditor({ slide, onChange, errors, disabled }: EditorProps<"qr_code">) {
	return (
		<div className="flex flex-col gap-4">
			<SlideTitleField<"qr_code">
				label="Title (optional)"
				placeholder={DEFAULT_TITLE}
				title={slide.title}
				onChange={onChange}
				errors={errors}
				disabled={disabled}
			/>
			<ToggleField
				label="Show join code"
				description="Show the code and address next to the QR code."
				checked={slide.config.show_join_code !== false}
				onChange={(checked) => onChange({ config: { show_join_code: checked } })}
				error={fieldError(errors, "show_join_code")}
				disabled={disabled}
			/>
			<p className="text-xs text-dark-5 dark:text-dark-6">
				The QR code and code come from the live session. The preview shows a sample code.
			</p>
		</div>
	);
}

/* ------------------------------------------------------------------ */

const subscribeNever = () => () => undefined;

/** window.location.origin on the client; null while server rendering / hydrating (no mismatch). */
function useOrigin(): string | null {
	return useSyncExternalStore(
		subscribeNever,
		() => window.location.origin,
		() => null
	);
}

/** "ABC234" → "ABC 234": groups of three read better from the back row. */
function formatCode(code: string): string {
	const clean = code.replace(/[\s-]/g, "").toUpperCase();
	return clean.length === 6 ? `${clean.slice(0, 3)} ${clean.slice(3)}` : clean;
}

export function QrCodePresenter({ run, theme, mode, session }: PresenterProps<"qr_code">) {
	const origin = useOrigin();
	const join = session?.join ?? null;
	const sample = mode === "preview" || !join;
	const code = join?.join_code ?? SAMPLE_CODE;
	// Same link as the presenter's QR sidebar: straight to the name step with the code filled in.
	// Before hydration finishes, fall back to the session's own join URL.
	const qrValue = origin ? `${origin}/play/${encodeURIComponent(code)}` : (join?.join_url ?? `/play/${code}`);
	const address = origin ? `${new URL(origin).host}/play` : "/play";
	const showCode = run.config.show_join_code !== false;
	const title = run.title && run.title.trim() !== "" ? run.title : DEFAULT_TITLE;

	return (
		<ContentStage theme={theme}>
			<div className="flex min-h-0 w-full flex-1 items-center justify-center gap-[6cqw]" style={{ fontSize: "clamp(12px, 2.5cqw, 72px)" }}>
				{showCode ? (
					<div className="flex min-w-0 flex-col items-start gap-[0.9em] text-left">
						<h1 className="m-0 font-bold leading-tight [overflow-wrap:anywhere]" style={{ fontSize: contentSize("stage", "title") }}>
							{title}
						</h1>
						<div>
							<p className="m-0 font-semibold uppercase tracking-wider" style={{ fontSize: contentSize("stage", "small"), color: "var(--deck-text-muted)" }}>
								Go to
							</p>
							<p className="m-0 font-bold [overflow-wrap:anywhere]" style={{ fontSize: contentSize("stage", "subtitle") }}>
								{address}
							</p>
						</div>
						<div>
							<p className="m-0 font-semibold uppercase tracking-wider" style={{ fontSize: contentSize("stage", "small"), color: "var(--deck-text-muted)" }}>
								{sample ? "Code (sample)" : "Enter code"}
							</p>
							<p
								className="m-0 whitespace-nowrap font-mono font-bold leading-none tracking-[0.12em]"
								style={{ fontSize: "2.6em", color: "var(--deck-primary)" }}
								aria-label={`Join code ${code.split("").join(" ")}`}
							>
								{formatCode(code)}
							</p>
						</div>
					</div>
				) : null}

				<div className="flex shrink-0 flex-col items-center gap-[0.6em]">
					{!showCode ? (
						<h1 className="m-0 text-center font-bold leading-tight" style={{ fontSize: contentSize("stage", "title") }}>
							{title}
						</h1>
					) : null}
					{/* White tile whatever the theme: phone scanners need dark-on-light contrast.
					    Sized in cqw only: the stage is always 16:9 (≈ 48cqw of usable height). */}
					<div className="rounded-[0.5em] bg-white p-[0.5em] shadow-sm" style={{ width: showCode ? "36cqw" : "33cqw" }}>
						<QRCodeSVG
							value={qrValue}
							size={512}
							level="M"
							bgColor="#FFFFFF"
							fgColor="#111928"
							style={{ width: "100%", height: "auto", display: "block", opacity: sample ? 0.85 : 1 }}
							role="img"
							aria-label={sample ? "Sample join QR code" : `QR code linking to ${qrValue}`}
						/>
					</div>
				</div>
			</div>
		</ContentStage>
	);
}

export function QrCodeParticipant({ run, theme }: ParticipantProps<"qr_code">) {
	return (
		<ContentPhone theme={theme} position={run.position}>
			<div role="status" className="flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center">
				<CheckCircle2 aria-hidden className="h-16 w-16" style={{ color: "var(--deck-success)" }} strokeWidth={1.75} />
				<h2 className="m-0 font-bold leading-tight" style={{ fontSize: contentSize("phone", "hero") }}>
					You&apos;re in!
				</h2>
				<p className="m-0 max-w-[22em] leading-snug" style={{ color: "var(--deck-text-muted)" }}>
					Others are joining with the code on the big screen. Follow along there.
				</p>
			</div>
		</ContentPhone>
	);
}
