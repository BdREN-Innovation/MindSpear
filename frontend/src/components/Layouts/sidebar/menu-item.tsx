import { cn } from "@/lib/utils";
import { cva } from "class-variance-authority";
import Link from "next/link";
import { useSidebarContext } from "./sidebar-context";

const menuItemBaseStyles = cva(
	"rounded-lg px-3.5 font-medium text-dark-4 transition-all duration-200 dark:text-dark-6 transform-gpu ",
	{
		variants: {
			isActive: {
				// The logo's orchid marks where you are; orange stays for the page's main action.
				true: "bg-secondary-100 font-semibold text-dark dark:bg-secondary-900/40 dark:text-white",
				false: "hover:bg-gray-100 hover:text-dark hover:dark:bg-[#FFFFFF1A] hover:dark:text-white ",
			},
		},
		defaultVariants: {
			isActive: false,
		},
	},
);

export function MenuItem(
	props: {
		className?: string;
		children: React.ReactNode;
		isActive: boolean;
		ariaExpanded?: boolean;
	} & ({ as?: "button"; onClick: () => void } | { as: "link"; href: string }),
) {
	const { toggleSidebar, isMobile } = useSidebarContext();

	if (props.as === "link") {
		return (
			<Link
				href={props.href}
				// Close sidebar on clicking link if it's mobile
				onClick={() => isMobile && toggleSidebar()}
				className={cn(
					menuItemBaseStyles({
						isActive: props.isActive,
						className: "relative block py-1",
					}),
					props.className,
				)}
			>
				{props.children}
			</Link>
		);
	}

	return (
		<button
			onClick={props.onClick}
			aria-expanded={props.ariaExpanded ?? props.isActive}
			className={cn(
				menuItemBaseStyles({
					isActive: props.isActive,
					className: `flex w-full items-center gap-3 py-1`,
				}),
				props.className,
			)}
		>
			{props.children}
		</button>
	);
}
