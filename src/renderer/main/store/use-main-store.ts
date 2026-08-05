import { create } from "zustand";
import type { CaptureState } from "../../../shared/capture";
import { INITIAL_CAPTURE_STATE } from "../../../shared/capture";

/**
 * Main window state: the active route and the latest capture state pushed
 * from the main process. The route is a discriminated union, per the plan:
 * four routes do not need a router library.
 */

export type Route = "dictate" | "history" | "models" | "settings";

export const ROUTE_LABELS: Record<Route, string> = {
  dictate: "Dictate",
  history: "History",
  models: "Models",
  settings: "Settings"
};

interface MainWindowState {
  route: Route;
  capture: CaptureState;
  setRoute: (route: Route) => void;
  setCapture: (capture: CaptureState) => void;
}

export const useMainStore = create<MainWindowState>((set) => ({
  route: "dictate",
  capture: INITIAL_CAPTURE_STATE,
  setRoute: (route) => {
    set({ route });
  },
  setCapture: (capture) => {
    set({ capture });
  }
}));
