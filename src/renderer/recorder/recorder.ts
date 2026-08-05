/**
 * The recorder window entry. It owns the microphone from Phase 2 on: a
 * permanently warm getUserMedia stream feeding the pcm-collector worklet.
 * In E2E mode the microphone is skipped entirely (tests drive the session
 * through a simulated source), and the window reports not-live.
 */

import type { RecorderWindowApi } from "../../shared/api";
import { initRecorderAudio } from "./audio";

// This renderer only ever runs inside the recorder window; its preload
// exposes windowKind "recorder", so the union narrows by construction.
const api = window.struqVoice as RecorderWindowApi;

if (api.isE2E) {
  api.sendStreamState({ live: false, reason: "e2e: microphone skipped" });
} else {
  initRecorderAudio(api);
}
