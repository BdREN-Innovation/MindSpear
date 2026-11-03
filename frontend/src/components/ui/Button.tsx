import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "outline";
type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: ButtonVariant;
	size?: ButtonSize;
	loading?: boolean;
};

const variantClasses: Record<ButtonVariant, string> = {
	// Dark text: white on this orange is too faint to read (about 2:1 contrast).
	primary: "bg-primary text-dark hover:bg-primary-dark focus-visible:ring-primary",
	secondary:
		"bg-secondary text-white hover:bg-secondary-dark focus-visible:ring-secondary",
	danger: "bg-red text-white hover:bg-red-dark focus-visible:ring-red",
	ghost: "bg-transparent text-dark hover:bg-gray-2 dark:text-white dark:hover:bg-dark-2",
	outline:
		"border border-stroke bg-white text-dark hover:bg-gray-1 dark:border-stroke-dark dark:bg-dark-2 dark:text-white",
};

const sizeClasses: Record<ButtonSize, string> = {
	sm: "h-9 px-3 text-sm",
	md: "h-10 px-4 text-sm",
	lg: "h-12 px-6 text-base",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	(
		{
			children,
			className,
			disabled,
			loading = false,
			size = "md",
			variant = "primary",
			type = "button",
			...props
		},
		ref,
	) => (
		<button
			ref={ref}
			type={type}
			disabled={disabled || loading}
			className={cn(
				"inline-flex items-center justify-center gap-2 rounded-lg font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60",
				variantClasses[variant],
				sizeClasses[size],
				className,
			)}
			{...props}
		>
			{loading ? (
				<span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
			) : null}
			{children}
		</button>
	),
);

Button.displayName = "Button";
