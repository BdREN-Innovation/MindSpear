"use client";

import { useId } from "react";
import ReactSelect, { type DropdownIndicatorProps, type SingleValue } from "react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption<T extends string> {
	value: T;
	label: string;
	disabled?: boolean;
}

export interface SelectProps<T extends string> {
	/** null: nothing chosen yet (shows the placeholder). */
	value: T | null;
	options: readonly SelectOption<T>[];
	onChange: (value: T) => void;
	/** Id of the focusable input, for a <label htmlFor>. */
	inputId?: string;
	"aria-label"?: string;
	placeholder?: string;
	/** Draws the error state (red border). */
	invalid?: boolean;
	disabled?: boolean;
	className?: string;
}

function Chevron<T extends string>({ selectProps }: DropdownIndicatorProps<SelectOption<T>, false>) {
	return <ChevronDown className={cn("mr-2.5 h-4 w-4 shrink-0 text-dark-5 transition-transform", selectProps.menuIsOpen && "rotate-180")} aria-hidden />;
}

const COMPONENTS = { DropdownIndicator: Chevron, IndicatorSeparator: null };

/**
 * A single-choice dropdown in the app's look, instead of the browser's own
 * list. The menu is drawn on <body>, so a modal or a scrolling panel never
 * cuts it off.
 */
export function Select<T extends string>({
	value,
	options,
	onChange,
	inputId,
	"aria-label": ariaLabel,
	placeholder = "Choose…",
	invalid = false,
	disabled,
	className,
}: SelectProps<T>) {
	// A stable id keeps react-select's generated ids the same on the server and in the browser.
	const instanceId = useId();
	const selected = options.find((option) => option.value === value) ?? null;

	return (
		<ReactSelect<SelectOption<T>, false>
			instanceId={instanceId}
			inputId={inputId}
			aria-label={ariaLabel}
			value={selected}
			options={options}
			onChange={(next: SingleValue<SelectOption<T>>) => {
				if (next) onChange(next.value);
			}}
			isDisabled={disabled}
			isOptionDisabled={(option) => !!option.disabled}
			placeholder={placeholder}
			aria-invalid={invalid || undefined}
			isSearchable={false}
			unstyled
			menuPortalTarget={typeof document === "undefined" ? null : document.body}
			menuPosition="fixed"
			menuPlacement="auto"
			// Above antd modals (z-index 1000).
			styles={{ menuPortal: (base) => ({ ...base, zIndex: 1100 }) }}
			components={COMPONENTS}
			formatOptionLabel={(option, { context }) =>
				context === "menu" ? (
					<span className="flex items-center justify-between gap-3">
						{option.label}
						{option.value === value ? <Check className="h-4 w-4 shrink-0" aria-hidden /> : null}
					</span>
				) : (
					option.label
				)
			}
			className={className}
			classNames={{
				control: ({ isFocused, isDisabled }) =>
					cn(
						"min-h-10 cursor-pointer rounded-lg border bg-white text-sm text-dark transition dark:bg-dark-2 dark:text-white",
						invalid
							? "border-red ring-red/30"
							: isFocused
								? "border-secondary ring-2 ring-secondary/20"
								: "border-stroke hover:border-secondary-200 dark:border-stroke-dark",
						isDisabled && "cursor-not-allowed opacity-60",
					),
				valueContainer: () => "px-3 py-2",
				singleValue: () => "text-dark dark:text-white",
				placeholder: () => "text-dark-6",
				menu: () => "mt-1 overflow-hidden rounded-lg border border-stroke bg-white py-1 text-sm shadow-lg dark:border-stroke-dark dark:bg-dark-2",
				option: ({ isFocused, isSelected, isDisabled }) =>
					cn(
						"cursor-pointer px-3 py-2",
						isDisabled
							? "cursor-not-allowed text-dark-6 opacity-60"
							: isSelected
								? "bg-secondary-50 font-semibold text-secondary-600 dark:bg-secondary-900/40 dark:text-secondary-200"
								: isFocused
									? "bg-gray-1 text-dark dark:bg-dark-3 dark:text-white"
									: "text-dark dark:text-white",
					),
			}}
		/>
	);
}
