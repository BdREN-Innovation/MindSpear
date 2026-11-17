import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata, Viewport } from "next";
import { PwaRegistrar } from "@/features/deck-participant/pwa/PwaRegistrar";

// Participant PWA routes (/play/...). Its own route group so the pages do NOT
// get (public)'s HeaderPublic: the participant shell (AppShell) owns the
// whole screen. viewport-fit=cover lets the shell pad with
// env(safe-area-inset-*) on notched phones.
//
// The manifest, Apple web-app tags and the service worker are scoped to
// these routes only (plan §4.1). theme-color starts at the default deck
// background; AppShell retints it to the deck's theme at runtime. The status
// bar style is "default" (dark text on a light bar): "black-translucent"
// would put white status-bar text over the white default theme.

export const metadata: Metadata = {
	title: { default: "Join · MindSpear", template: "%s · MindSpear" },
	description: "Join a live MindSpear session: vote, answer and ask questions from your phone.",
	applicationName: "MindSpear",
	manifest: "/manifest.webmanifest",
	appleWebApp: { capable: true, title: "MindSpear", statusBarStyle: "default" },
	formatDetection: { telephone: false, email: false, address: false },
	icons: {
		icon: [
			{ url: "/images/logo/favicon.svg", type: "image/svg+xml" },
			{ url: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" },
		],
		shortcut: "/images/logo/favicon.svg",
		apple: [{ url: "/pwa/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
	},
	other: {
		// Older iOS reads only the apple- prefixed name.
		"apple-mobile-web-app-capable": "yes",
	},
};

export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
	viewportFit: "cover",
	themeColor: "#FFFFFF",
};

/**
 * The Next build id (written to .next/BUILD_ID before pages are generated),
 * so the service worker's caches roll over with every deploy. "dev" under
 * `next dev`, where no BUILD_ID is written.
 */
const BUILD_VERSION = (() => {
	try {
		return readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim() || "dev";
	} catch {
		return "dev";
	}
})();

export default function PlayLayout({ children }: { children: React.ReactNode }) {
	return (
		<>
			<PwaRegistrar version={BUILD_VERSION} />
			{children}
		</>
	);
}
