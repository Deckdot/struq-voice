import { describe, expect, it, vi } from "vitest";
import { createCaptureSoundPlayer } from "./capture-sounds";
import type { CaptureSoundOptions } from "./capture-sounds";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] }
}));

interface Sent {
  readonly channel: string;
  readonly payload: { bytes: ArrayBuffer; volume: number };
}

const harness = (
  overrides: Partial<CaptureSoundOptions> = {}
): {
  sent: Sent[];
  reads: string[];
  options: CaptureSoundOptions;
} => {
  const sent: Sent[] = [];
  const reads: string[] = [];
  const fakeWindow = {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: { bytes: ArrayBuffer; volume: number }) => {
        sent.push({ channel, payload });
      },
      getURL: () => "file:///app/out/renderer/recorder/index.html"
    }
  };

  const options: CaptureSoundOptions = {
    isEnabled: () => true,
    getVolume: () => 0.4,
    soundsDir: "/sounds",
    findRecorderWindow: () => fakeWindow as never,
    read: (path: string) => {
      reads.push(path);
      return Promise.resolve(Buffer.from([1, 2, 3, 4]));
    },
    ...overrides
  };
  return { sent, reads, options };
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe("createCaptureSoundPlayer", () => {
  it("sends the open sound to the recorder window", async () => {
    const { sent, options } = harness();
    createCaptureSoundPlayer(options).play("open");
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.payload.volume).toBe(0.4);
  });

  it("plays nothing when sounds are switched off", async () => {
    const { sent, options } = harness({ isEnabled: () => false });
    const player = createCaptureSoundPlayer(options);
    player.play("open");
    player.play("close");
    await flush();
    expect(sent).toHaveLength(0);
  });

  it("reads each sound file once and reuses the bytes", async () => {
    const { reads, options } = harness();
    const player = createCaptureSoundPlayer(options);
    player.play("open");
    await flush();
    player.play("open");
    await flush();
    player.play("open");
    await flush();
    expect(reads.filter((p) => p.includes("open"))).toHaveLength(1);
  });

  it("uses a different file for open and close", async () => {
    const { reads, options } = harness();
    const player = createCaptureSoundPlayer(options);
    player.play("open");
    await flush();
    player.play("close");
    await flush();
    expect(reads.some((p) => p.includes("open.wav"))).toBe(true);
    expect(reads.some((p) => p.includes("close.wav"))).toBe(true);
  });

  it("never throws when the sound file is missing", async () => {
    const { sent, options } = harness({
      read: () => Promise.reject(new Error("ENOENT"))
    });
    const player = createCaptureSoundPlayer(options);
    expect(() => {
      player.play("open");
    }).not.toThrow();
    await flush();
    expect(sent).toHaveLength(0);
  });

  it("does not retry a file that already failed to read", async () => {
    let attempts = 0;
    const { options } = harness({
      read: () => {
        attempts += 1;
        return Promise.reject(new Error("ENOENT"));
      }
    });
    const player = createCaptureSoundPlayer(options);
    player.play("open");
    await flush();
    player.play("open");
    await flush();
    player.play("open");
    await flush();
    expect(attempts).toBe(1);
  });

  it("does nothing when the recorder window is gone", async () => {
    const { sent, options } = harness({ findRecorderWindow: () => null });
    createCaptureSoundPlayer(options).play("open");
    await flush();
    expect(sent).toHaveLength(0);
  });

  it("sends a detachable copy so the cached buffer survives repeat plays", async () => {
    const { sent, options } = harness();
    const player = createCaptureSoundPlayer(options);
    player.play("open");
    await flush();
    player.play("open");
    await flush();

    expect(sent).toHaveLength(2);
    // Both payloads carry the same bytes, from separate buffers: a structured
    // clone of the first must not leave the second empty.
    expect(sent[0]?.payload.bytes.byteLength).toBe(4);
    expect(sent[1]?.payload.bytes.byteLength).toBe(4);
    expect(sent[0]?.payload.bytes).not.toBe(sent[1]?.payload.bytes);
  });

  it("reads the volume at play time, not at construction", async () => {
    let volume = 0.1;
    const { sent, options } = harness({ getVolume: () => volume });
    const player = createCaptureSoundPlayer(options);
    player.play("open");
    await flush();
    volume = 0.9;
    player.play("open");
    await flush();
    expect(sent[0]?.payload.volume).toBe(0.1);
    expect(sent[1]?.payload.volume).toBe(0.9);
  });

  it("reads the enabled flag at play time, not at construction", async () => {
    let enabled = false;
    const { sent, options } = harness({ isEnabled: () => enabled });
    const player = createCaptureSoundPlayer(options);
    player.play("open");
    await flush();
    expect(sent).toHaveLength(0);

    enabled = true;
    player.play("open");
    await flush();
    expect(sent).toHaveLength(1);
  });

  it("warmup loads both files before any capture", async () => {
    const { reads, options } = harness();
    await createCaptureSoundPlayer(options).warmup();
    expect(reads).toHaveLength(2);
  });
});
