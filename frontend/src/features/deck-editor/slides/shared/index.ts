// Shared widgets for the slide type folders (Editor / Presenter / Participant).

export { OptionListEditor, type OptionListEditorProps } from "./OptionListEditor";
export {
	ImageSlot,
	LibraryErrorNotice,
	MediaSlot,
	useLibraryUpload,
	VIDEO_URL_PATTERN,
	type ImageSlotProps,
	type LibraryUpload,
	type MediaAccept,
	type MediaSlotProps,
} from "./media";
export {
	CharCount,
	FieldShell,
	NumberField,
	RadioCardField,
	SegmentedField,
	SelectField,
	TextAreaField,
	TextField,
	ToggleField,
	type ChoiceOption,
	type FieldBaseProps,
	type NumberFieldProps,
	type RadioCardFieldProps,
	type RadioCardOption,
	type SegmentedFieldProps,
	type SelectFieldProps,
	type TextAreaFieldProps,
	type TextFieldProps,
	type ToggleFieldProps,
} from "./fields";
export { BarChart, type BarChartItem, type BarChartProps } from "./BarChart";
export { PresenterStage, ResponseCount, ResultsEmpty, SlideTitle, type ResponseCountProps, type SlideTitleProps } from "./presenter";
export {
	OptionCard,
	OptionCardGroup,
	SubmitBar,
	SubmittedState,
	type OptionCardGroupProps,
	type OptionCardProps,
	type SubmitBarProps,
	type SubmittedStateProps,
} from "./participant";
export { submitErrorMessage, useSubmit, type UseSubmitResult } from "./useSubmit";
export { haptic, useDebouncedValue, usePrefersReducedMotion } from "./hooks";

// Quiz (QF1): additive helpers for the quiz slide types.
export {
	CorrectMarker,
	EditorError,
	EditorWarning,
	InlineSelect,
	OptionLabelInput,
	nextAuthorKey,
	useCorrectMarking,
	type CorrectMarking,
	type OptionLabelInputProps,
} from "./quizEditor";
export {
	ChoiceTiles,
	CorrectSummary,
	LetterBadge,
	PercentBar,
	QuizHeader,
	REVEAL_BADGE_GAP_S,
	REVEAL_BAR_S,
	REVEAL_STAGGER_S,
	RevealBars,
	RevealMark,
	StageHint,
	StageMessage,
	SubmittedCount,
	quizStageHint,
	useRevealTiming,
	type ChoiceTile,
	type RevealBarItem,
	type RevealTiming,
} from "./quizPresenter";
export {
	LockedIn,
	PointsBar,
	QuizResultBanner,
	ResultHeading,
	ResultRow,
	ToneIcon,
	quizPhase,
	useEarnablePoints,
	type QuizPhase,
	type QuizResultInfo,
	type ResultTone,
} from "./quizParticipant";
export { formatPoints, optionLetter, plural, quizDisplayTitle, quizFallbackTitle, rankLabel, resolveStanding } from "./quizLabels";
