"use client";

// Shell-wide CSS that Tailwind utilities cannot express per element (plan
// §4.4 / §4.6), scoped to `.ms-play-shell`. React 19 hoists and dedupes a
// <style> with href + precedence, so every AppShell can render it safely.

const SHELL_CSS = `
.ms-play-shell {
	-webkit-tap-highlight-color: transparent;
	-webkit-text-size-adjust: 100%;
	text-size-adjust: 100%;
}
.ms-play-shell :is(button, a, label, input, select, textarea, summary, [role="button"], [role="tab"], [role="radio"], [role="checkbox"], [role="option"], [role="slider"]) {
	touch-action: manipulation;
}
.ms-play-shell :is(button, [role="button"], [role="tab"], [role="radio"]) {
	-webkit-user-select: none;
	user-select: none;
}
.ms-play-shell img {
	-webkit-touch-callout: none;
	-webkit-user-drag: none;
}
/* iOS zooms into inputs under 16px. */
.ms-play-shell :is(input, select, textarea) {
	font-size: max(16px, 1em);
}
/* Containers focused from code (sheet panels, tabindex=-1) get no ring. */
.ms-play-shell :focus-visible:not([tabindex="-1"]) {
	outline: 3px solid var(--deck-focus, #C46620);
	outline-offset: 2px;
}
.ms-play-scroll {
	-webkit-overflow-scrolling: touch;
	overscroll-behavior: contain;
}
@keyframes ms-play-dot {
	0%, 80%, 100% { transform: scale(0.55); opacity: 0.35; }
	40% { transform: scale(1); opacity: 1; }
}
.ms-play-dot {
	animation: ms-play-dot 1.2s infinite ease-in-out both;
}
@keyframes ms-play-caret {
	0%, 100% { opacity: 1; }
	50% { opacity: 0; }
}
.ms-play-caret {
	animation: ms-play-caret 1s steps(1) infinite;
}
@media (prefers-reduced-motion: reduce) {
	.ms-play-shell *, .ms-play-shell *::before, .ms-play-shell *::after,
	.ms-play-dot, .ms-play-caret {
		animation-duration: 0.001ms !important;
		animation-iteration-count: 1 !important;
		transition-duration: 0.001ms !important;
		scroll-behavior: auto !important;
	}
}
`;

export function ShellStyles() {
	return (
		<style href="ms-play-shell" precedence="default">
			{SHELL_CSS}
		</style>
	);
}
