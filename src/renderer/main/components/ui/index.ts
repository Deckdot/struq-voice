/**
 * The shared visual layer. Every view builds from these rather than
 * re-typing Tailwind strings, so the design system is enforced in one place
 * instead of re-derived per file.
 */

export { Badge } from "./Badge";
export type { BadgeProps, BadgeTone } from "./Badge";
export { Button } from "./Button";
export type { ButtonProps, ButtonSize, ButtonVariant } from "./Button";
export { Card } from "./Card";
export type { CardProps } from "./Card";
export { Field } from "./Field";
export type { FieldProps } from "./Field";
export { HotkeyCapture } from "./HotkeyCapture";
export type { HotkeyCaptureProps } from "./HotkeyCapture";
export { Kbd } from "./Kbd";
export type { KbdProps } from "./Kbd";
export { ProgressBar, formatBytes } from "./ProgressBar";
export type { ProgressBarProps } from "./ProgressBar";
export { Section } from "./Section";
export type { SectionProps } from "./Section";
export { StatusDot } from "./StatusDot";
export type { StatusDotProps } from "./StatusDot";
