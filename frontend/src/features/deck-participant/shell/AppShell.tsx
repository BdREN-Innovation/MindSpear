"use client";

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { DeckThemeProvider, getDeckTheme, type DeckTheme } from "@/features/deck/theme";
import { recentNavigation, type NavDirection } from "./navDirection";
import { useKeyboardInset } from "./useKeyboardInset";
import { ShellStyles } from "./shellStyles";

// Full-viewport participant frame (plan §4.2): safe-area padding, the deck
// palette as --deck-* variables (DeckThemeProvider), the browser theme-color
// following the deck background, and one polite live region for state
// announcements (§4.6). Everything inside reads the context through
// useParticipantShell().

export interface ParticipantShellContextValue {
	theme: DeckTheme;
	/** Height the on-screen keyboard covers (px), 0 when closed. */
	keyboardInset: number;
	/** True inside an AppShell: the shell already lifts its content above the keyboard. */
	managesKeyboard: boolean;
	/** Screen-reader announcement (aria-live="polite"); repeated messages are re-announced. */
	announce: (message: string) => void;
}

const noop = () => undefined;

const ParticipantShellContext = createContext<ParticipantShellContextValue>({
	theme: getDeckTheme(null),
	keyboardInset: 0,
	managesKeyboard: false,
	announce: noop,
});

export function useParticipantShell(): ParticipantShellContextValue {
	return useContext(ParticipantShellContext);
}

/** Shortcut for useParticipantShell().announce. */
export function useAnnounce(): (message: string) => void {
	return useContext(ParticipantShellContext).announce;
}

/** Sets <meta name="theme-color"> while mounted (status bar / Android task colour), restoring the old value after. */
function useThemeColorMeta(color: string) {
	useEffect(() => {
		let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
		let created = false;
		if (!meta) {
			meta = document.createElement("meta");
			meta.name = "theme-color";
			document.head.appendChild(meta);
			created = true;
		}
		const previous = meta.content;
		meta.content = color;
		return () => {
			if (created) meta?.remove();
			else if (meta) meta.content = previous;
		};
	}, [color]);
}

export interface AppShellProps {
	/** Deck theme key (decks.settings.theme) or a resolved theme; default palette when missing. */
	theme?: string | DeckTheme | null;
	/** Usually a <TopBar/>. It pads itself for the top safe area; without one the shell does. */
	topBar?: ReactNode;
	/** Sticky bottom area (actions); padded for the home indicator. */
	footer?: ReactNode;
	/** Rendered between the top bar and the content (connection banners). */
	banner?: ReactNode;
	children: ReactNode;
	/** Classes for the scrolling content area. */
	contentClassName?: string;
	/** Changing it replays the entrance transition (e.g. the run id). */
	transitionKey?: string | number;
	/**
	 * 1 = slide in from the right (forward), -1 = from the left (back), 0 = fade
	 * up. Default: the direction of a navigation marked just before this mount
	 * (markNavigation). Off under reduced motion.
	 */
	transitionDirection?: NavDirection;
	/** Element id of the scrolling content (for skip links / tests). */
	contentId?: string;
}

export function AppShell({
	theme,
	topBar,
	footer,
	banner,
	children,
	contentClassName,
	transitionKey,
	transitionDirection,
	contentId,
}: AppShellProps) {
	const resolved = useMemo(() => (typeof theme === "object" && theme ? theme : getDeckTheme(theme)), [theme]);
	const keyboardInset = useKeyboardInset();
	const reduceMotion = useReducedMotion();
	const [mountDirection] = useState(recentNavigation);
	const direction = transitionDirection ?? mountDirection;
	useThemeColorMeta(resolved.themeColor);

	// Live region: clear then set, so the same sentence twice is announced twice.
	const [announcement, setAnnouncement] = useState("");
	const timer = useRef<number | undefined>(undefined);
	const announce = useCallback((message: string) => {
		window.clearTimeout(timer.current);
		setAnnouncement("");
		timer.current = window.setTimeout(() => setAnnouncement(message), 60);
	}, []);
	useEffect(() => () => window.clearTimeout(timer.current), []);

	const value = useMemo(
		() => ({ theme: resolved, keyboardInset, managesKeyboard: true, announce }),
		[resolved, keyboardInset, announce]
	);

	return (
		<DeckThemeProvider
			theme={resolved}
			className="ms-play-shell fixed inset-0 flex flex-col overflow-hidden bg-[var(--deck-bg)] font-sans text-[var(--deck-text)] antialiased"
			style={{
				paddingLeft: "env(safe-area-inset-left)",
				paddingRight: "env(safe-area-inset-right)",
				// The keyboard covers the bottom of the fixed frame: lift everything above it.
				paddingBottom: keyboardInset || undefined,
			}}
		>
			<ShellStyles />
			<ParticipantShellContext.Provider value={value}>
				{topBar ?? <div aria-hidden style={{ height: "env(safe-area-inset-top)" }} className="shrink-0" />}
				{banner}
				<main
					id={contentId}
					className={cn("ms-play-scroll relative flex-1 overflow-y-auto overflow-x-hidden", contentClassName)}
				>
					<motion.div
						key={transitionKey}
						className="flex min-h-full flex-col"
						initial={
							reduceMotion
								? false
								: direction
									? { opacity: 0, x: 32 * direction, y: 0 }
									: { opacity: 0, x: 0, y: 12 }
						}
						animate={{ opacity: 1, x: 0, y: 0 }}
						transition={{ type: "spring", stiffness: 380, damping: 34 }}
					>
						{children}
					</motion.div>
				</main>
				{footer && (
					<div
						className="shrink-0 border-t border-[var(--deck-border)] bg-[var(--deck-bg)] px-4 pt-3"
						style={{ paddingBottom: keyboardInset ? 12 : "max(env(safe-area-inset-bottom), 12px)" }}
					>
						{footer}
					</div>
				)}
				{!footer && !keyboardInset && (
					<div aria-hidden className="shrink-0" style={{ height: "env(safe-area-inset-bottom)" }} />
				)}
				<div aria-live="polite" aria-atomic="true" role="status" className="sr-only">
					{announcement}
				</div>
			</ParticipantShellContext.Provider>
		</DeckThemeProvider>
	);
}
