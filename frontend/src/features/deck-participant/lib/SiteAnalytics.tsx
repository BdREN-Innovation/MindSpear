"use client";

import { usePathname } from "next/navigation";
import { GoogleAnalytics, GoogleTagManager } from "@next/third-parties/google";

// Google Tag Manager + Analytics for the site, but never on the participant
// app (/play/...): third-party scripts there could read participant tokens in
// sessionStorage and see URLs carrying a session's public channel key.
// Rendered by the root layout; usePathname is known during SSR, so a direct
// /play load never emits the tags. A script loaded on another page stays for
// that tab, so entry points into /play (e.g. /join) use a full page load.

export const PARTICIPANT_APP_PREFIX = "/play";

// The site's tag ids (moved here from app/layout.tsx unchanged).
const GTM_ID = "GTM-KZQCJTWJ";
const GA_ID = "G-XYZ";

export function isParticipantAppPath(pathname: string | null): boolean {
	return !!pathname && (pathname === PARTICIPANT_APP_PREFIX || pathname.startsWith(`${PARTICIPANT_APP_PREFIX}/`));
}

export function SiteAnalytics() {
	const pathname = usePathname();
	if (isParticipantAppPath(pathname)) return null;
	return (
		<>
			<GoogleTagManager gtmId={GTM_ID} />
			<GoogleAnalytics gaId={GA_ID} />
		</>
	);
}
