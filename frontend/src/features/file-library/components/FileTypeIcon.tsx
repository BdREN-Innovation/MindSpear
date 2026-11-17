import { cn } from "@/lib/utils";
import { typeStyle } from "../lib/format";
import type { LibraryFile } from "../types";

/**
 * A file as people picture one: a page with a folded corner and the type
 * (PPTX, PDF, DOCX …) on a band in that format's colour. Decorative: the type
 * is always written next to it too.
 */
export function FileTypeIcon({ file, className }: { file: Pick<LibraryFile, "extension" | "category">; className?: string }) {
	const { label, color } = typeStyle(file);
	const fontSize = label.length <= 3 ? 9 : label.length === 4 ? 8 : 6.5;

	return (
		<svg viewBox="0 0 40 48" fill="none" className={cn("shrink-0", className)} aria-hidden>
			<path
				d="M8 1.5h18.5l10 10v32a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-39a3 3 0 0 1 3-3Z"
				className="fill-white stroke-[#CBD5E1] dark:stroke-[#64748B]"
				strokeWidth="1.5"
			/>
			<path d="M26.5 1.5v7a3 3 0 0 0 3 3h7" className="fill-[#F1F5F9] stroke-[#CBD5E1] dark:stroke-[#64748B]" strokeWidth="1.5" strokeLinejoin="round" />
			<path d="M11 16.5h12M11 21h17" stroke="#E2E8F0" strokeWidth="2" strokeLinecap="round" />
			<rect x="1" y="26" width="31" height="13" rx="2.5" fill={color} />
			<text x="16.5" y="35.4" textAnchor="middle" fontSize={fontSize} fontWeight="700" letterSpacing="0.4" fill="#fff" fontFamily="inherit">
				{label}
			</text>
		</svg>
	);
}
