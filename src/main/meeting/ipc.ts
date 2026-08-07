/**
 * The meeting IPC surface: every meeting: channel plus the meeting-audio
 * channels the hidden capture window uses. Every handler is thin: validate,
 * call the store or the session, return. No logic. A null store degrades to
 * empty results, never a rejected invoke.
 */

import { BrowserWindow, ipcMain, shell } from "electron";
import type { MeetingStore } from "../db/meeting-store";
import type { MeetingAssetService } from "./assets";
import type { MeetingSession } from "./meeting-session";
import type {
  MeetingAudioStateEvent,
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
import type { WorkerFrames } from "./worker/protocol";

const PAGE_SIZE = 50;

const sendToMainWindow = (channel: string, payload: unknown): void => {
  const window = BrowserWindow.getAllWindows().find((candidate) =>
    candidate.webContents.getURL().includes("main/index.html")
  );
  if (window !== undefined) {
    window.webContents.send(channel, payload);
  }
};

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

  // WS7 adds the meetingExportChannel handler on top of this module.
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
  ipcMain.on(meetingAudioFramesChannel, (_event, frames: WorkerFrames) => {
    session.handleFrames(frames);
  });

  ipcMain.on(meetingAudioArchiveChannel, (_event, chunk: { bytes: ArrayBuffer }) => {
    session.handleArchiveChunk(chunk.bytes);
  });

  ipcMain.on(meetingAudioStateChannel, (_event, event: MeetingAudioStateEvent) => {
    session.handleAudioState(event);
  });

  ipcMain.on(meetingAudioLevelsChannel, (_event, event) => {
    sendToMainWindow(meetingLevelsChannel, event);
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
