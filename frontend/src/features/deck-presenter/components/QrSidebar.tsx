"use client";

import { QRCodeSVG } from "qrcode.react";
import { Users } from "lucide-react";
import { formatJoinCode, joinDisplayUrl, joinQrUrl } from "../lib/join";

// Left sidebar (plan §6.2): join address, big code, QR. The QR sits on a
// white tile whatever the deck theme, because phone scanners need contrast.

export interface QrSidebarProps {
	joinCode: string;
	participantCount: number | null;
}

export function QrSidebar({ joinCode, participantCount }: QrSidebarProps) {
	const qrUrl = joinQrUrl(joinCode);
	const code = formatJoinCode(joinCode);

	return (
		<aside
			aria-label="How to join"
			className="flex h-full w-[clamp(240px,22vw,380px)] shrink-0 flex-col items-center justify-center gap-[clamp(12px,2.2vh,28px)] overflow-y-auto border-r border-[var(--deck-border)] bg-[var(--deck-surface)] px-[clamp(16px,1.6vw,32px)] py-6 text-center"
		>
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

			<p className="flex items-center gap-2 text-lg font-semibold" aria-live="polite">
				<Users className="h-5 w-5" aria-hidden />
				{participantCount ?? 0} joined
			</p>
		</aside>
	);
}
