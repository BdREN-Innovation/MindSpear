"use client";

import { QRCodeSVG } from "qrcode.react";
import { Users, X } from "lucide-react";
import type { RoomParticipant } from "@/features/deck/types";
import { formatJoinCode, joinDisplayUrl, joinQrUrl } from "../lib/join";
import { ParticipantNames } from "./ParticipantNames";

// Left sidebar (plan §6.2): join address, big code, QR. The QR sits on a
// white tile whatever the deck theme, because phone scanners need contrast.
// Under it, who has joined (newest first). The × hides it; the control bar's
// QR button (or Q) brings it back.

export interface QrSidebarProps {
	joinCode: string;
	participantCount: number | null;
	/** Newest first; names of who has joined. */
	participants?: RoomParticipant[];
	onClose?: () => void;
}

export function QrSidebar({ joinCode, participantCount, participants = [], onClose }: QrSidebarProps) {
	const qrUrl = joinQrUrl(joinCode);
	const code = formatJoinCode(joinCode);

	return (
		<aside
			aria-label="How to join"
			className="relative flex h-full w-[clamp(240px,22vw,380px)] shrink-0 flex-col items-center justify-[safe_center] gap-[clamp(12px,2.2vh,28px)] overflow-y-auto border-r border-[var(--deck-border)] bg-[var(--deck-surface)] px-[clamp(16px,1.6vw,32px)] py-6 text-center"
		>
			{onClose ? (
				<button
					type="button"
					onClick={onClose}
					aria-label="Hide the join sidebar (Q)"
					title="Hide the join sidebar (Q)"
					className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full text-[var(--deck-text-muted)] transition hover:bg-[var(--deck-surface-muted)] hover:text-[var(--deck-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--deck-focus,#C46620)]"
				>
					<X className="h-5 w-5" aria-hidden />
				</button>
			) : null}
			<div>
				<p className="text-sm font-semibold uppercase tracking-wider text-[var(--deck-text-muted)]">Join at</p>
				<p className="mt-1 break-all text-[clamp(1.125rem,1.6vw,1.75rem)] font-bold">{joinDisplayUrl()}</p>
			</div>

			<div>
				<p className="text-sm font-semibold uppercase tracking-wider text-[var(--deck-text-muted)]">Code</p>
				<p
					className="mt-1 whitespace-nowrap font-mono text-[clamp(2rem,3.2vw,3.5rem)] font-bold leading-none tracking-[0.12em] text-[var(--deck-primary)]"
					aria-label={`Join code ${joinCode.split("").join(" ")}`}
				>
					{code}
				</p>
			</div>

			<div className="w-full max-w-[300px] rounded-2xl bg-white p-[clamp(8px,0.8vw,16px)] shadow-sm">
				<QRCodeSVG
					value={qrUrl}
					size={512}
					level="M"
					bgColor="#FFFFFF"
					fgColor="#111928"
					style={{ width: "100%", height: "auto", display: "block" }}
					role="img"
					aria-label={`QR code linking to ${qrUrl}`}
				/>
			</div>

			<div className="flex w-full flex-col items-center gap-2">
				<p className="flex items-center gap-2 text-lg font-semibold" aria-live="polite">
					<Users className="h-5 w-5" aria-hidden />
					{participantCount ?? 0} joined
				</p>
				<ParticipantNames participants={participants} total={participantCount ?? participants.length} max={24} />
			</div>
		</aside>
	);
}
