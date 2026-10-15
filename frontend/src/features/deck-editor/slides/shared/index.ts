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
	SegmentedField,
	SelectField,
	TextAreaField,
	TextField,
	ToggleField,
	type ChoiceOption,
	type FieldBaseProps,
	type NumberFieldProps,
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
