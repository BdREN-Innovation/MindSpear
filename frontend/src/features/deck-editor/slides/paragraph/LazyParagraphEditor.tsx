"use client";

import dynamic from "next/dynamic";

// TipTap / ProseMirror are only needed in the deck editor. The registry is
// also bundled into the presenter and the participant PWA, so the editor is
// split into its own chunk and loaded on first use.
export const LazyParagraphEditor = dynamic(() => import("./ParagraphEditor").then((module) => module.ParagraphEditor), {
	ssr: false,
	loading: () => (
		<div role="status" className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-stroke text-sm text-dark-5 dark:border-dark-3 dark:text-dark-6">
			Loading text editor…
		</div>
	),
});
