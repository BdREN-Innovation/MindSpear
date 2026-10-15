/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import { FileText, FileVideo, ImageOff, Presentation, FileType2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { typeStyle } from "../lib/format";
import type { LibraryFile } from "../types";

function DocIcon({ file, className }: { file: Pick<LibraryFile, "category" | "extension">; className?: string }) {
	const extension = file.extension;
	if (file.category === "video") return <FileVideo className={className} aria-hidden />;
	if (extension === "pptx") return <Presentation className={className} aria-hidden />;
	if (extension === "txt") return <FileType2 className={className} aria-hidden />;
	return <FileText className={className} aria-hidden />;
}

/** Image preview, or a coloured video/document tile with the file type (videos aren't loaded just to show a thumbnail). */
export function FileThumb({ file, size = "md", className }: { file: LibraryFile; size?: "sm" | "md"; className?: string }) {
	const [broken, setBroken] = useState(false);
	const style = typeStyle(file);

	if (file.category === "image" && file.isPublic) {
		return (
			<div className={cn("flex items-center justify-center overflow-hidden bg-gray-2 dark:bg-dark-3", className)}>
				{broken ? (
					<ImageOff className="h-6 w-6 text-dark-5" aria-label="Preview unavailable" />
				) : (
					<img src={file.url} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setBroken(true)} />
				)}
			</div>
		);
	}

	return (
		<div className={cn("flex flex-col items-center justify-center gap-1.5", style.className, className)}>
			<DocIcon file={file} className={size === "sm" ? "h-5 w-5" : "h-9 w-9"} />
			{size === "md" ? <span className="text-xs font-bold tracking-wide">{style.label}</span> : null}
		</div>
	);
}
