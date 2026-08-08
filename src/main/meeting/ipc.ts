/**
 * The meeting IPC surface: every meeting: channel plus the meeting-audio
 * channels the hidden capture window uses. Every handler is thin: validate,
 * call the store or the session, return. No logic. A null store degrades to
 * empty results, never a rejected invoke.
 */

import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { writeFile } from "node:fs/promises";
import type { MeetingStore } from "../db/meeting-store";
import type { MeetingAssetService } from "./assets";
import { exportMeeting } from "./export";
import type { MeetingSession } from "./meeting-session";
import type {
  MeetingAudioFrames,
  MeetingAudioStateEvent,
  MeetingExportRequest,
  MeetingExportResult,
  MeetingGetRequest,
  MeetingGetResult,
  MeetingListRequest,
  MeetingListResult,
  MeetingPauseResult,
  MeetingRenameRequest,
  MeetingRenameSpeakerRequest,
  MeetingSearchRequest,
  MeetingSearchResult,
  MeetingSegmentsRequest,
  MeetingSegmentsResult,
  MeetingSimpleResult
} from "../../shared/ipc";
import {
  meetingAssetProgressChannel,
  meetingAssetsChannel,
  meetingAudioArchiveChannel,
  meetingAudioFramesChannel,
  meetingAudioLevelsChannel,
  meetingAudioStateChannel,
  meetingDeleteChannel,
  meetingExportChannel,
  meetingGetChannel,
  meetingInstallAssetsChannel,
  meetingLevelsChannel,
  meetingListChannel,
  meetingPauseChannel,
  meetingRenameChannel,
  meetingRenameSpeakerChannel,
  meetingRevealRecordingChannel,
  meetingSearchChannel,
  meetingSegmentsChannel,
  meetingStartChannel,
  meetingStopChannel
} from "../../shared/ipc";

const PAGE_SIZE = 50;

const sendToMainWindow = (channel: string, payload: unknown): void => {
  const window = BrowserWindow.getAllWindows().find((candidate) =>
    candidate.webContents.getURL().includes("main/index.html")
  );
  if (window !== undefined) {
    window.webContents.send(channel, payload);
  }
};

const sendToFeedbackWindows = (channel: string, payload: unknown): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    const url = window.webContents.getURL();
    if (url.includes("main/index.html") || url.includes("overlay/index.html")) {
      window.webContents.send(channel, payload);
    }
  }
};

/**
 * The audio data plane carries raw PCM straight into the worker, so only the
 * hidden meeting window may speak on it. Any other renderer is refused rather
 * than trusted by virtue of being in-process.
 */
const isMeetingWindow = (sender: Electron.WebContents): boolean =>
  sender.getURL().includes("meeting/index.html");

export const registerMeetingIpcHandlers = (
  store: MeetingStore | null,
  session: MeetingSession,
  assets: MeetingAssetService
): void => {
  ipcMain.handle(meetingStartChannel, async () => {
    return await session.start();
  });

  ipcMain.handle(meetingStopChannel, async (): Promise<MeetingSimpleResult> => {
    await session.stop();
    return { ok: true };
  });

  ipcMain.handle(meetingPauseChannel, (): MeetingPauseResult => {
    return { ok: true, paused: session.togglePause() };
  });

  ipcMain.handle(
    meetingListChannel,
    (_event, request: MeetingListRequest): MeetingListResult => {
      if (store === null) return { items: [], total: 0 };
      const limit = request.limit ?? PAGE_SIZE;
      const offset = request.offset ?? 0;
      return {
        items: store.listMeetings(limit, offset),
        total: store.countMeetings()
      };
    }
  );

  ipcMain.handle(
    meetingGetChannel,
    (_event, request: MeetingGetRequest): MeetingGetResult => {
      if (store === null) return { meeting: null, speakers: [] };
      return {
        meeting: store.getMeeting(request.meetingId),
        speakers: store.listSpeakers(request.meetingId)
      };
    }
  );

  ipcMain.handle(
    meetingSegmentsChannel,
    (_event, request: MeetingSegmentsRequest): MeetingSegmentsResult => {
      if (store === null) return { items: [], total: 0 };
      const limit = request.limit ?? 200;
      const offset = request.offset ?? 0;
      return {
        items: store.listSegments(request.meetingId, limit, offset),
        total: store.countSegments(request.meetingId)
      };
    }
  );

  ipcMain.handle(
    meetingSearchChannel,
    (_event, request: MeetingSearchRequest): MeetingSearchResult => {
      if (store === null) return { items: [] };
      return { items: store.searchSegments(request.query, request.limit ?? 50) };
    }
  );

  ipcMain.handle(
    meetingDeleteChannel,
    (_event, request: MeetingGetRequest): MeetingSimpleResult => {
      if (store === null) return { ok: false };
      return { ok: store.removeMeeting(request.meetingId) };
    }
  );

  ipcMain.handle(
    meetingRenameChannel,
    (_event, request: MeetingRenameRequest): MeetingSimpleResult => {
      if (store === null) return { ok: false };
      const title = request.title.trim();
      if (title.length === 0) return { ok: false };
      return { ok: store.setTitle(request.meetingId, title) };
    }
  );

  ipcMain.handle(
    meetingRenameSpeakerChannel,
    (_event, request: MeetingRenameSpeakerRequest): MeetingSimpleResult => {
      if (store === null) return { ok: false };
      const label = request.label.trim();
      if (label.length === 0) return { ok: false };
      store.setSpeakerLabel(request.meetingId, request.speakerKey, label);
      return { ok: true };
    }
  );

  // WS7: the export handler, added after the format module landed.
  ipcMain.handle(
    meetingExportChannel,
    async (_event, request: MeetingExportRequest): Promise<MeetingExportResult> => {
      if (store === null) return { ok: false, code: "database-unavailable" };
      const meeting = store.getMeeting(request.meetingId);
      if (meeting === null) return { ok: false, code: "not-found" };
      const segments = store.listSegments(request.meetingId, 1_000_000, 0);
      const speakers = store.listSpeakers(request.meetingId);
      const content = exportMeeting({
        meeting,
        segments,
        speakers,
        format: request.format
      });
      const extension =
        request.format === "srt" ? "srt" : request.format === "text" ? "txt" : "md";
      const picked = await dialog.showSaveDialog({
        title: "Export meeting",
        defaultPath: `${meeting.title}.${extension}`,
        filters: [{ name: "Export", extensions: [extension] }]
      });
      if (picked.canceled || picked.filePath.length === 0) {
        return { ok: false, code: "cancelled" };
      }
      try {
        await writeFile(picked.filePath, content, "utf8");
        return { ok: true, path: picked.filePath };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void message;
        return { ok: false, code: "write-failed" };
      }
    }
  );

  ipcMain.handle(
    meetingRevealRecordingChannel,
    (_event, request: MeetingGetRequest): MeetingSimpleResult => {
      if (store === null) return { ok: false };
      const meeting = store.getMeeting(request.meetingId);
      if (meeting === null || meeting.audioPath === null) return { ok: false };
      shell.showItemInFolder(meeting.audioPath);
      return { ok: true };
    }
  );

  ipcMain.handle(meetingAssetsChannel, () => {
    return assets.list();
  });

  ipcMain.handle(meetingInstallAssetsChannel, async (): Promise<MeetingSimpleResult> => {
    if (assets.isReady()) return { ok: true };
    try {
      await assets.installMissing();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // The meeting window's own channels. Main forwards, holds nothing.
  ipcMain.on(meetingAudioFramesChannel, (event, frames: MeetingAudioFrames) => {
    if (!isMeetingWindow(event.sender)) return;
    session.handleFrames(frames);
  });

  ipcMain.on(meetingAudioArchiveChannel, (event, chunk: { bytes: ArrayBuffer }) => {
    if (!isMeetingWindow(event.sender)) return;
    session.handleArchiveChunk(chunk.bytes);
  });

  ipcMain.on(meetingAudioStateChannel, (event, audioState: MeetingAudioStateEvent) => {
    if (!isMeetingWindow(event.sender)) return;
    session.handleAudioState(audioState);
  });

  ipcMain.on(meetingAudioLevelsChannel, (event, levels) => {
    if (!isMeetingWindow(event.sender)) return;
    sendToFeedbackWindows(meetingLevelsChannel, levels);
  });

  assets.subscribe((result) => {
    for (const item of result.items) {
      // Progress events stream at the downloader's throttle; terminal states
      // are pushed once so the install card never freezes on the last tick.
      if (item.download.state === "downloading") {
        sendToMainWindow(meetingAssetProgressChannel, {
          state: "downloading",
          assetId: item.id,
          receivedBytes: item.download.receivedBytes,
          totalBytes: item.download.totalBytes
        });
      } else if (item.download.state === "done") {
        sendToMainWindow(meetingAssetProgressChannel, {
          state: "done",
          assetId: item.id
        });
      } else if (item.download.state === "error") {
        sendToMainWindow(meetingAssetProgressChannel, {
          state: "error",
          assetId: item.id,
          code: item.download.code,
          message: item.download.message
        });
      }
    }
  });
};
