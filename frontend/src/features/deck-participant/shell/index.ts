// Participant PWA shell primitives (plan §4.2). Shared with Quiz v2 later.
export { AppShell, useAnnounce, useParticipantShell } from "./AppShell";
export type { AppShellProps, ParticipantShellContextValue } from "./AppShell";
export { TopBar } from "./TopBar";
export type { TopBarProps } from "./TopBar";
export { SheetModal } from "./SheetModal";
export type { SheetModalProps } from "./SheetModal";
export { TapFeedback } from "./TapFeedback";
export type { TapFeedbackProps } from "./TapFeedback";
export { KeyboardAwareView } from "./KeyboardAwareView";
export { useKeyboardInset } from "./useKeyboardInset";
export { LoadingDots } from "./LoadingDots";
export { PullIndicator } from "./PullIndicator";
export { PlayButton } from "./PlayButton";
export type { PlayButtonProps } from "./PlayButton";
export { pulse, useHaptics, hapticsSupported, getHapticsPreference, setHapticsPreference } from "./haptics";
export type { HapticKind, HapticsControls } from "./haptics";
