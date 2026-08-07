/**
 * The meeting capture window entry. It owns the Windows loopback stream, an
 * optional second microphone stream, and the opus archive encoder, for the
 * duration of one meeting. Under STRUQ_VOICE_E2E the window is never created,
 * so unlike the recorder there is no e2e branch to write.
 */

import type { MeetingWindowApi } from "../../shared/api";
import { initMeetingAudio } from "./audio";

// This renderer only ever runs inside the meeting window; its preload
// exposes windowKind "meeting", so the union narrows by construction.
const api = window.struqVoice as MeetingWindowApi;

initMeetingAudio(api);
