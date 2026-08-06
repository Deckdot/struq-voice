/**
 * Derived MessageKey type from the English source of truth catalog.
 * Any key used in the codebase that is missing from en.ts will produce a compile error.
 */

import type { en } from "./locales/en";

export type MessageKey = keyof typeof en;

export type TranslationParams = Record<string, string | number>;
