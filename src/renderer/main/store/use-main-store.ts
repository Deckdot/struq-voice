import { create } from "zustand";
import type { CaptureState } from "../../../shared/capture";
import { INITIAL_CAPTURE_STATE } from "../../../shared/capture";
import type { MeetingState } from "../../../shared/meeting";
import { INITIAL_MEETING_STATE } from "../../../shared/meeting";
import type { MainWindowApi } from "../../../shared/api";

/**
 * Main window state: the active route, the latest capture state pushed from
 * the main process, the app readiness cluster and the theme mode. The route
 * is a discriminated union, per the plan: six routes do not need a router
 * library.
 */

export type Route = "dictate" | "meetings" | "history" | "dictionary" | "models" | "settings";

export const ROUTE_ORDER: readonly Route[] = [
  "dictate",
  "meetings",
  "history",
  "dictionary",
  "models",
  "settings"
];

export const ROUTE_LABELS: Record<Route, string> = {
  dictate: "Dictate",
  meetings: "Meetings",
  history: "History",
  dictionary: "Dictionary",
  models: "Models",
  settings: "Settings"
};

/** Whether the two things the product depends on are actually up. */
export interface AppReadiness {
  readonly microphone: { readonly live: boolean; readonly reason?: string };
  readonly hotkeysActive: boolean;
}

export interface MainWindowState {
  route: Route;
  /** The sign of the last navigation, for page transitions. */
  routeDirection: 1 | -1;
  capture: CaptureState;
  meeting: MeetingState;
  /** Selected meeting in the Meetings detail view, or null for the library. */
  meetingDetailId: number | null;
  readiness: AppReadiness;
  themeMode: "system" | "light" | "dark";
  /**
   * The resolved UI locale and its direction. Held here rather than in each
   * useTranslation caller: there are twenty of them, and one settings
   * subscription for the window is enough.
   */
  locale: string;
  dir: "ltr" | "rtl";
  /**
   * True once the splash curtain has started to lift. Views that own an
   * entrance animation read it so their motion is not spent behind a cover.
   */
  shellRevealed: boolean;
  /** Search intent handed from the command palette to the History view. */
  historySearch: { readonly query: string; readonly focusId: number | null } | null;
  setHistorySearch: (payload: { readonly query: string; readonly focusId: number | null }) => void;
  consumeHistorySearch: () => void;
  setRoute: (next: Route) => void;
  setCapture: (next: CaptureState) => void;
  setMeeting: (next: MeetingState) => void;
  setMeetingDetailId: (next: number | null) => void;
  setReadiness: (next: AppReadiness) => void;
  setThemeMode: (next: "system" | "light" | "dark") => void;
  setLocale: (locale: string, dir: "ltr" | "rtl") => void;
  setShellRevealed: (next: boolean) => void;
  getRouteDirection: () => 1 | -1;
}

// Main passes the resolved locale in additionalArguments so the first paint is
// already in the right language. Read it once here rather than flashing English.
const bootApi = window.struqVoice as MainWindowApi | undefined;

export const useMainStore = create<MainWindowState>((set, get) => ({
  route: "dictate",
  routeDirection: 1,
  capture: INITIAL_CAPTURE_STATE,
  meeting: INITIAL_MEETING_STATE,
  meetingDetailId: null,
  readiness: { microphone: { live: false }, hotkeysActive: false },
  themeMode: "system",
  locale: bootApi?.initialLocale ?? "en",
  dir: bootApi?.initialDir ?? "ltr",
  shellRevealed: false,
  historySearch: null,
  setHistorySearch: (historySearch) => {
    set({ historySearch });
  },
  consumeHistorySearch: () => {
    set({ historySearch: null });
  },
  setRoute: (next) => {
    const prev = get().route;
    const delta = ROUTE_ORDER.indexOf(next) - ROUTE_ORDER.indexOf(prev);
    const direction: 1 | -1 = delta > 0 ? 1 : delta < 0 ? -1 : get().routeDirection;
    set({ route: next, routeDirection: direction });
  },
  setCapture: (capture) => {
    set({ capture });
  },
  setMeeting: (meeting) => {
    set({ meeting });
  },
  setMeetingDetailId: (meetingDetailId) => {
    set({ meetingDetailId });
  },
  setReadiness: (readiness) => {
    set({ readiness });
  },
  setThemeMode: (themeMode) => {
    set({ themeMode });
  },
  setLocale: (locale, dir) => {
    set({ locale, dir });
  },
  setShellRevealed: (shellRevealed) => {
    set({ shellRevealed });
  },
  getRouteDirection: () => get().routeDirection
}));
