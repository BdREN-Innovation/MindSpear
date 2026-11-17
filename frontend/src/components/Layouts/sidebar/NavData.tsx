import React, { useState, useEffect } from "react";
import { NAV_DATA } from "./data";
import { MenuItem } from "./menu-item";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ChevronUp } from "./icons";

type SubItemNew = {
	title: string;
	url: string;
	// icon can be a React component or a string path to an image/svg in public/
	icon?: React.ElementType | string;
};
type NavItem = {
	title: string;
	url?: string;
	// icon can be a React component or a string path to an image/svg in public/
	icon?: React.ElementType | string;
	items?: NavItem[];
};

// First path segment of each top-level section, e.g. "fun-games".
const SECTION_ROOTS = new Set(
	NAV_DATA.flatMap((section) =>
		section.items.map((item) => item.url.split("/")[1]),
	),
);

function NavData() {
	const pathname = usePathname();
	const [expandedItems, setExpandedItems] = useState<string[]>([]);

	const toggleExpanded = (title: string) => {
		setExpandedItems((prev) => (prev.includes(title) ? [] : [title]));
	};

	// Return true when `itemUrl` should be considered active for current `pathname`.
	// Handles exact matches, child routes (startsWith), and treats "-page"
	// list routes as matching their base resource (e.g. `/quest-page` -> `/quest`).
	const isPathMatch = (itemUrl?: string) => {
		if (!itemUrl) return false;

		const normalized = itemUrl.replace(/-page$/, "");
		const tokens = normalized.split("/").filter(Boolean);
		const resource = tokens.length ? tokens[tokens.length - 1] : null;
		const pathSegments = pathname.split("/").filter(Boolean);
		// A path under another top-level section (e.g. /fun-games/…) never lights up this item.
		const inOtherSection =
			SECTION_ROOTS.has(pathSegments[0]) && pathSegments[0] !== tokens[0];

		return (
			pathname === itemUrl ||
			pathname === normalized ||
			pathname.startsWith(normalized + "/") ||
			(!!resource && !inOtherSection && pathSegments.includes(resource))
		);
	};

	// When several siblings match, only the most specific one is active.
	const activeSubUrl = (items: SubItemNew[]) =>
		items
			.filter((subItem) => isPathMatch(subItem.url))
			.sort((a, b) => b.url.length - a.url.length)[0]?.url;

	// Auto-expand parent when a subitem matches current pathname
	useEffect(() => {
		NAV_DATA.forEach((section) => {
			section.items.forEach((item) => {
				if (item.items?.some((sub) => isPathMatch(sub.url))) {
					setExpandedItems((prev) =>
						prev.includes(item.title) ? prev : [item.title],
					);
				}
			});
		});
	}, [pathname]);

	return (
		<div>
			{NAV_DATA.map((section) => (
				<div key={section.label} className="mb-6">
					<nav role="navigation" aria-label={section.label}>
						<ul className="space-y-1 text-[0.875rem]">
							{section.items.map((item) => (
								<li key={item.title}>
									{item.items && item.items.length > 0 ? (
										<>
											<MenuItem
												isActive={false}
												ariaExpanded={expandedItems.includes(
													item.title,
												)}
												onClick={() =>
													toggleExpanded(item.title)
												}
												className={cn(
													"flex items-center gap-3 py-2",
													item.items.some(({ url }) =>
														isPathMatch(url),
													) &&
														"font-bold text-orange-500 hover:text-orange-500",
												)}
											>
												{item.icon ? (
													typeof item.icon ===
													"string" ? (
														<img
															src={item.icon}
															className="w-8 h-8 shrink-0"
															aria-hidden="true"
															alt=""
														/>
													) : (
														<item.icon
															className="w-8 h-8 shrink-0"
															aria-hidden="true"
														/>
													)
												) : null}

												<span>{item.title}</span>

												<ChevronUp
													className={cn(
														"ml-auto transition-transform duration-200",
														expandedItems.includes(
															item.title,
														)
															? "rotate-180"
															: "rotate-90",
													)}
													aria-hidden="true"
												/>
											</MenuItem>

											<div
												className={cn(
													"ml-8 mr-0 pr-0 overflow-hidden transition-[max-height,opacity,padding] duration-300 ease-out",
													expandedItems.includes(
														item.title,
													)
														? "pt-2 pb-[15px] max-h-[400px] opacity-100"
														: "pt-0 pb-0 max-h-0 opacity-0",
												)}
												role="region"
												aria-hidden={
													!expandedItems.includes(
														item.title,
													)
												}
											>
												<ul
													className="space-y-1"
													role="menu"
												>
													{item.items.map(
														(
															subItem: SubItemNew,
														) => (
															<li
																key={
																	subItem.title
																}
																role="none"
															>
																<MenuItem
																	as="link"
																	href={
																		subItem.url
																	}
																	isActive={
																		subItem.url ===
																		activeSubUrl(
																			item.items,
																		)
																	}
																	className="flex items-center gap-3 py-2"
																>
																	{subItem.icon ? (
																		typeof subItem.icon ===
																		"string" ? (
																			<img
																				src={
																					subItem.icon
																				}
																				className="w-6 h-6 shrink-0 text-muted"
																				aria-hidden="true"
																				alt=""
																			/>
																		) : (
																			(() => {
																				const Icon =
																					subItem.icon as React.ElementType;
																				return (
																					<Icon
																						className="w-6 h-6 shrink-0 text-muted"
																						aria-hidden="true"
																					/>
																				);
																			})()
																		)
																	) : null}
																	<span>
																		{
																			subItem.title
																		}
																	</span>
																</MenuItem>
															</li>
														),
													)}
												</ul>
											</div>
										</>
									) : (
										(() => {
											const href =
												"url" in item
													? item.url
													: "/" +
														(item as NavItem).title
															.toLowerCase()
															.split(" ")
															.join("-");
											return (
												<MenuItem
													className="flex items-center gap-3 py-2"
													as="link"
													href={href}
													isActive={pathname === href}
												>
													{item.icon ? (
														<item.icon
															className="size-6 shrink-0"
															aria-hidden="true"
														/>
													) : null}
													<span>{item.title}</span>
												</MenuItem>
											);
										})()
									)}
								</li>
							))}
						</ul>
					</nav>
				</div>
			))}
		</div>
	);
}

export default NavData;
