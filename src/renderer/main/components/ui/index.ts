/**
 * The shared visual layer. Every view builds from these rather than
 * re-typing Tailwind, so the design system is enforced in one place
 * instead of re-derived per file.
 */

export { Badge } from "./Badge";
export type { BadgeProps, BadgeTone } from "./Badge";

export { Button } from "./Button";
export type { ButtonProps, ButtonSize, ButtonVariant } from "./Button";

export { Card } from "./Card";
export type { CardProps } from "./Card";

export { Checkbox } from "./Checkbox";
export type { CheckboxProps } from "./Checkbox";

export { Dialog } from "./Dialog";
export type { DialogProps } from "./Dialog";

export { Disclosure } from "./Disclosure";
export type { DisclosureProps } from "./Disclosure";

export { DropdownMenu } from "./DropdownMenu";
export type { DropdownMenuItem, DropdownMenuProps } from "./DropdownMenu";

export { EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";

export { Field } from "./Field";
export type { FieldProps } from "./Field";

export { HotkeyRecorder } from "./HotkeyRecorder";
export type { HotkeyRecorderProps } from "./HotkeyRecorder";

export { IconButton } from "./IconButton";
export type { IconButtonProps, IconButtonSize, IconButtonVariant } from "./IconButton";

export { InlineError } from "./InlineError";
export type { InlineErrorProps } from "./InlineError";

export { Kbd } from "./Kbd";
export type { KbdProps } from "./Kbd";

export { ModelRow } from "./ModelRow";
export type { ModelRowProps, SpeedLabel } from "./ModelRow";

export { NumberInput } from "./NumberInput";
export type { NumberInputProps } from "./NumberInput";

export { Popover } from "./Popover";
export type { PopoverProps } from "./Popover";

export { ProgressBar, formatBytes } from "./ProgressBar";
export type { ProgressBarProps, ProgressTone } from "./ProgressBar";

export { RadioGroup } from "./RadioGroup";
export type { RadioGroupProps, RadioOption } from "./RadioGroup";

export { SearchInput } from "./SearchInput";
export type { SearchInputProps } from "./SearchInput";

export { Section } from "./Section";
export type { SectionProps } from "./Section";

export { SegmentedControl } from "./SegmentedControl";
export type { SegmentedControlOption, SegmentedControlProps } from "./SegmentedControl";

export { Select } from "./Select";
export type { SelectProps } from "./Select";

export { SettingsGroup } from "./SettingsGroup";
export { SettingsRow } from "./SettingsRow";
export type { SettingsGroupProps } from "./SettingsGroup";
export type { SettingsRowProps } from "./SettingsRow";

export { Skeleton } from "./Skeleton";
export type { SkeletonProps } from "./Skeleton";

export { Slider } from "./Slider";
export type { SliderProps } from "./Slider";

export { SettingsNote } from "./SettingsNote";
export type { SettingsNoteProps } from "./SettingsNote";
export { StatTile, Sparkline } from "./StatTile";
export type { StatTileProps } from "./StatTile";
export { StatusDot } from "./StatusDot";
export type { StatusDotProps, StatusState } from "./StatusDot";

export { Switch } from "./Switch";
export type { SwitchProps } from "./Switch";

export { Tabs } from "./Tabs";
export type { TabsProps } from "./Tabs";

export { TextInput } from "./TextInput";
export type { TextInputProps } from "./TextInput";

export { Tooltip, TooltipProvider } from "./Tooltip";
export type { TooltipProps, TooltipProviderProps } from "./Tooltip";

export { TranscriptRow } from "./TranscriptRow";
export type { TranscriptRowProps } from "./TranscriptRow";
