/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LibraryFile } from "../types";
import { FileTypeIcon } from "./FileTypeIcon";

/** Image preview, or the file-type icon for videos and documents (videos aren't loaded just to show a thumbnail). */
export function FileThumb({ file, size = "md", className }: { file: LibraryFile; size?: "sm" | "md"; className?: string }) {
	const [broken, setBroken] = useState(false);

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
		<div className={cn("flex items-center justify-center", size === "md" && "bg-gray-1 dark:bg-dark-3", className)}>
			<FileTypeIcon file={file} className={size === "sm" ? "h-9 w-auto" : "h-16 w-auto"} />
		</div>
	);
}
