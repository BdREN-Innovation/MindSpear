"use client";

import { Download, Pencil, Trash2 } from "lucide-react";
import { ActionsMenu } from "@/components/ui";

interface Props {
	fileName: string;
	onRename: () => void;
	onDownload: () => void;
	onDelete: () => void;
	className?: string;
}

/** ⋮ menu with Rename / Download / Delete for one file. */
export function FileActionsMenu({ fileName, onRename, onDownload, onDelete, className }: Props) {
	return (
		<ActionsMenu
			label={`Actions for ${fileName}`}
			className={className}
			items={[
				{ label: "Rename", icon: Pencil, onSelect: onRename },
				{ label: "Download", icon: Download, onSelect: onDownload },
				{ label: "Delete", icon: Trash2, onSelect: onDelete, danger: true },
			]}
		/>
	);
}
