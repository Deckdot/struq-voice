/**
 * Capture sounds, from the main side.
 *
 * Reads the sound files once, then pushes the bytes to the recorder window
 * for playback. The recorder plays them because it is hidden and permanently
 * alive: anything that creates or shows a window mid-capture risks changing
 * the foreground, and the foreground window is where the transcript has to
 * land.
 *
 * Every failure here is silent by design. A sound is confirmation that the key
 * registered; if the file is missing or unreadable, the capture must still run
 * exactly as before.
 */

import { BrowserWindow } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CaptureSound } from "../../shared/ipc";
import { recorderPlaySoundChannel } from "../../shared/ipc";

export interface CaptureSoundPlayer {
  /** Play a sound, unless sounds are switched off. Never throws. */
  play: (sound: CaptureSound) => void;
  /** Load both files into memory ahead of the first capture. */
  warmup: () => Promise<void>;
}

export interface CaptureSoundOptions {
  /** Read at play time: the user can change it between captures. */
  readonly isEnabled: () => boolean;
  readonly getVolume: () => number;
  /** Test seam. Defaults to the packaged resources directory. */
  readonly soundsDir?: string;
  /** Test seam. Defaults to the live recorder window. */
  readonly findRecorderWindow?: () => BrowserWindow | null;
  /** Test seam. Defaults to node:fs readFile. */
  readonly read?: (path: string) => Promise<Buffer>;
}

const FILES: Record<CaptureSound, string> = {
  open: "open.wav",
  close: "close.wav"
};

export const createCaptureSoundPlayer = (
  options: CaptureSoundOptions
): CaptureSoundPlayer => {
  // Same base as the tray icons in tray.ts: out/main up to the app root.
  const soundsDir =
    options.soundsDir ?? join(__dirname, "../../resources/sounds");
  const read = options.read ?? readFile;
  const findRecorder =
    options.findRecorderWindow ??
    ((): BrowserWindow | null =>
      BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes("recorder/index.html")
      ) ?? null);

  // null marks a file we already failed to read, so a missing sound is not
  // retried on every capture for the life of the process.
  const cache = new Map<CaptureSound, Buffer | null>();

  const load = async (sound: CaptureSound): Promise<Buffer | null> => {
    const cached = cache.get(sound);
    if (cached !== undefined) return cached;
    try {
      const bytes = await read(join(soundsDir, FILES[sound]));
      cache.set(sound, bytes);
      return bytes;
    } catch {
      cache.set(sound, null);
      return null;
    }
  };

  return {
    warmup: async (): Promise<void> => {
      await Promise.all([load("open"), load("close")]);
    },
    play: (sound: CaptureSound): void => {
      if (!options.isEnabled()) return;
      void (async (): Promise<void> => {
        try {
          const bytes = await load(sound);
          if (bytes === null) return;
          const recorder = findRecorder();
          if (recorder === null || recorder.isDestroyed()) return;
          // A copy of the exact bytes, so the cached Buffer is never detached
          // by the structured clone and stays reusable for the next capture.
          const copy = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
          );
          recorder.webContents.send(recorderPlaySoundChannel, {
            bytes: copy,
            volume: options.getVolume()
          });
        } catch {
          // Never let a sound disturb a capture.
        }
      })();
    }
  };
};
