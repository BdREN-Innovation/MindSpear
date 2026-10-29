"use client";

import { cn } from "@/lib/utils";
import { ArrowLeftIcon } from "./icons";
import NavData from "./NavData";
import { useSidebarContext } from "./sidebar-context";

/** The app's main navigation: sticky on desktop, a drawer with an overlay on mobile. */
export function Sidebar() {
	const { setIsOpen, isOpen, isMobile, toggleSidebar } = useSidebarContext();

	return (
		<>
			{isMobile && isOpen && (
				<div
					className="fixed inset-0 z-40 bg-black/50 transition-opacity duration-300"
					onClick={() => setIsOpen(false)}
					aria-hidden="true"
				/>
			)}

			<aside
				className={cn(
					"h-screen max-w-[220px] overflow-y-auto bg-white transition-[width] duration-200 ease-linear dark:bg-gray-dark",
					isMobile ? "fixed bottom-0 top-0 z-50" : "sticky top-0",
					isOpen ? "w-full" : "w-0"
				)}
				aria-label="Main navigation"
				aria-hidden={!isOpen}
				inert={!isOpen}
			>
				<div className="flex h-full flex-col overflow-y-auto rounded-lg dark:border-none">
					<div className="relative bg-white py-[13px] pl-[15px] pr-[7px]">
						{isMobile && (
							<button onClick={toggleSidebar} className="absolute left-3/4 right-4.5 top-1/2 -translate-y-1/2 text-right">
								<span className="sr-only">Close Menu</span>
								<ArrowLeftIcon className="ml-auto size-7" />
							</button>
						)}
					</div>
					<div className="custom-scrollbar flex-1 overflow-y-auto px-3">
						<NavData />
					</div>
				</div>
			</aside>
		</>
	);
}
