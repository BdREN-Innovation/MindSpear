"use client";

import { createContext, createElement, useContext, useMemo, type CSSProperties, type ReactNode } from "react";

// Deck colour palettes (decks.settings.theme). The backend stores any slug
// ([a-z0-9][a-z0-9_-]*, ≤ 40, default 'default') and leaves the palettes to
// the frontend; unknown keys fall back to 'default'. Backend tests use
// 'default', 'dark' and 'ocean', so those three must exist.
//
// Components read colours through CSS variables (--deck-*) so one subtree can
// be re-themed without prop drilling:
//   <div className="bg-[var(--deck-bg)] text-[var(--deck-text)]">
// Text/background pairs keep ≥ 4.5:1 contrast; chart colours are distinct on
// the deck background.

export type DeckThemeKey = "default" | "dark" | "ocean" | "sunset" | "forest" | "midnight" | "mono";

export interface DeckThemeColors {
	/** Slide / app background. */
	background: string;
	/** Cards, option tiles, panels. */
	surface: string;
	/** Inputs, muted fills, empty chart bars. */
	surfaceMuted: string;
	text: string;
	textMuted: string;
	border: string;
	/** Primary action / highlight (buttons, selected option). */
	primary: string;
	/** Text/icons on `primary`. */
	onPrimary: string;
	/** Secondary accent (second series, badges). */
	accent: string;
	success: string;
	danger: string;
	/** Focus ring. */
	focus: string;
	/** Categorical chart series, in order. */
	chart: string[];
}

export interface DeckTheme {
	key: DeckThemeKey;
	label: string;
	/** Dark background: use light text and light-on-dark imagery. */
	isDark: boolean;
	/** For <meta name="theme-color"> (PWA status bar). */
	themeColor: string;
	colors: DeckThemeColors;
	/** The palette as CSS custom properties (--deck-*). */
	cssVars: Record<`--deck-${string}`, string>;
}

const BRAND_CHART = ["#F79945", "#BC5EB3", "#3C50E0", "#22AD5C", "#ED3A76", "#0EA5E9", "#F59E0B", "#64748B"];

const PALETTES: Record<DeckThemeKey, Omit<DeckTheme, "cssVars" | "key">> = {
	default: {
		label: "MindSpear",
		isDark: false,
		themeColor: "#FFFFFF",
		colors: {
			background: "#FFFFFF",
			surface: "#F9FAFB",
			surfaceMuted: "#F3F4F6",
			text: "#111928",
			textMuted: "#4B5563",
			border: "#E5E7EB",
			primary: "#F79945",
			onPrimary: "#111928",
			accent: "#BC5EB3",
			success: "#15803D",
			danger: "#B91C1C",
			focus: "#C46620",
			chart: BRAND_CHART,
		},
	},
	dark: {
		label: "Dark",
		isDark: true,
		themeColor: "#111928",
		colors: {
			background: "#111928",
			surface: "#1F2A37",
			surfaceMuted: "#374151",
			text: "#F9FAFB",
			textMuted: "#D1D5DB",
			border: "#374151",
			primary: "#F79945",
			onPrimary: "#111928",
			accent: "#D080C8",
			success: "#4ADE80",
			danger: "#F87171",
			focus: "#FFBA75",
			chart: ["#F9B474", "#D894D2", "#93A5F5", "#4ADE80", "#FA82AA", "#7DD3FC", "#FCD34D", "#CBD5E1"],
		},
	},
	ocean: {
		label: "Ocean",
		isDark: false,
		themeColor: "#ECFEFF",
		colors: {
			background: "#ECFEFF",
			surface: "#FFFFFF",
			surfaceMuted: "#CFFAFE",
			text: "#083344",
			textMuted: "#155E75",
			border: "#A5F3FC",
			primary: "#0E7490",
			onPrimary: "#FFFFFF",
			accent: "#4F46E5",
			success: "#047857",
			danger: "#B91C1C",
			focus: "#0369A1",
			chart: ["#0E7490", "#4F46E5", "#0EA5E9", "#14B8A6", "#6366F1", "#22D3EE", "#1E3A8A", "#64748B"],
		},
	},
	sunset: {
		label: "Sunset",
		isDark: false,
		themeColor: "#FFF7ED",
		colors: {
			background: "#FFF7ED",
			surface: "#FFFFFF",
			surfaceMuted: "#FFEDD5",
			text: "#431407",
			textMuted: "#9A3412",
			border: "#FED7AA",
			primary: "#C2410C",
			onPrimary: "#FFFFFF",
			accent: "#BE185D",
			success: "#15803D",
			danger: "#B91C1C",
			focus: "#9A3412",
			chart: ["#C2410C", "#BE185D", "#F59E0B", "#E11D48", "#7C3AED", "#EA580C", "#DB2777", "#78716C"],
		},
	},
	forest: {
		label: "Forest",
		isDark: false,
		themeColor: "#F0FDF4",
		colors: {
			background: "#F0FDF4",
			surface: "#FFFFFF",
			surfaceMuted: "#DCFCE7",
			text: "#052E16",
			textMuted: "#166534",
			border: "#BBF7D0",
			primary: "#15803D",
			onPrimary: "#FFFFFF",
			accent: "#A16207",
			success: "#15803D",
			danger: "#B91C1C",
			focus: "#166534",
			chart: ["#15803D", "#A16207", "#0F766E", "#65A30D", "#B45309", "#047857", "#4D7C0F", "#57534E"],
		},
	},
	midnight: {
		label: "Midnight",
		isDark: true,
		themeColor: "#1E1B4B",
		colors: {
			background: "#1E1B4B",
			surface: "#312E81",
			surfaceMuted: "#3730A3",
			text: "#EEF2FF",
			textMuted: "#C7D2FE",
			border: "#4338CA",
			primary: "#FBBF24",
			onPrimary: "#1E1B4B",
			accent: "#F472B6",
			success: "#4ADE80",
			danger: "#FCA5A5",
			focus: "#FDE68A",
			chart: ["#FBBF24", "#F472B6", "#60A5FA", "#34D399", "#C084FC", "#FB923C", "#22D3EE", "#E2E8F0"],
		},
	},
	mono: {
		label: "Monochrome",
		isDark: false,
		themeColor: "#FAFAFA",
		colors: {
			background: "#FAFAFA",
			surface: "#FFFFFF",
			surfaceMuted: "#F4F4F5",
			text: "#09090B",
			textMuted: "#52525B",
			border: "#E4E4E7",
			primary: "#18181B",
			onPrimary: "#FFFFFF",
			accent: "#52525B",
			success: "#15803D",
			danger: "#B91C1C",
			focus: "#18181B",
			chart: ["#18181B", "#52525B", "#71717A", "#A1A1AA", "#3F3F46", "#27272A", "#D4D4D8", "#E4E4E7"],
		},
	},
};

export const DEFAULT_DECK_THEME_KEY: DeckThemeKey = "default";

export const DECK_THEME_KEYS = Object.keys(PALETTES) as DeckThemeKey[];

function toCssVars(colors: DeckThemeColors): DeckTheme["cssVars"] {
	const vars: DeckTheme["cssVars"] = {
		"--deck-bg": colors.background,
		"--deck-surface": colors.surface,
		"--deck-surface-muted": colors.surfaceMuted,
		"--deck-text": colors.text,
		"--deck-text-muted": colors.textMuted,
		"--deck-border": colors.border,
		"--deck-primary": colors.primary,
		"--deck-on-primary": colors.onPrimary,
		"--deck-accent": colors.accent,
		"--deck-success": colors.success,
		"--deck-danger": colors.danger,
		"--deck-focus": colors.focus,
	};
	colors.chart.forEach((color, index) => {
		vars[`--deck-chart-${index + 1}`] = color;
	});
	return vars;
}

export const DECK_THEMES: Record<DeckThemeKey, DeckTheme> = Object.fromEntries(
	DECK_THEME_KEYS.map((key) => [key, { key, ...PALETTES[key], cssVars: toCssVars(PALETTES[key].colors) }])
) as Record<DeckThemeKey, DeckTheme>;

export function isDeckThemeKey(value: unknown): value is DeckThemeKey {
	return typeof value === "string" && value in PALETTES;
}

/** The palette for decks.settings.theme (unknown / missing → default). */
export function getDeckTheme(key: string | null | undefined): DeckTheme {
	return DECK_THEMES[isDeckThemeKey(key) ? key : DEFAULT_DECK_THEME_KEY];
}

/** Chart colour for series `index` (wraps around). */
export function chartColor(theme: DeckTheme, index: number): string {
	const chart = theme.colors.chart;
	return chart[((index % chart.length) + chart.length) % chart.length];
}

const DeckThemeContext = createContext<DeckTheme>(DECK_THEMES[DEFAULT_DECK_THEME_KEY]);

/** The nearest DeckThemeProvider's theme (default palette outside one). */
export function useDeckTheme(): DeckTheme {
	return useContext(DeckThemeContext);
}

export interface DeckThemeProviderProps {
	/** A theme key (decks.settings.theme) or a resolved theme. */
	theme: string | DeckTheme | null | undefined;
	children?: ReactNode;
	/** Wrapper element (default div). The CSS variables are set on it. */
	as?: "div" | "main" | "section";
	className?: string;
	style?: CSSProperties;
}

/** Provides the theme via context and sets the --deck-* variables on a wrapper element. */
export function DeckThemeProvider({ theme, children, as = "div", className, style }: DeckThemeProviderProps) {
	const resolved = useMemo(() => (typeof theme === "object" && theme ? theme : getDeckTheme(theme)), [theme]);
	const wrapperStyle = useMemo(
		() => ({ ...(resolved.cssVars as CSSProperties), colorScheme: resolved.isDark ? "dark" : "light", ...style }),
		[resolved, style]
	);

	return createElement(
		DeckThemeContext.Provider,
		{ value: resolved },
		createElement(as, { className, style: wrapperStyle, "data-deck-theme": resolved.key }, children)
	);
}
