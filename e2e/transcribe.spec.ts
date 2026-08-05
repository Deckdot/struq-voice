import { expect, test } from "@playwright/test";
import { MOCK_TRANSCRIPT } from "../src/shared/engines";
import { launchApp, testHook } from "./helpers/launch";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

test("a capture transcribes, writes a history row and delivers", async () => {
  const { app, consoleErrors, close } = await launchApp();

  try {
    await testHook.drive.start(app);
    await expect.poll(async () => (await testHook.getState(app)).phase).toBe("listening");

    // Exceed minCaptureMs so the capture is not discarded.
    await sleep(500);

    await testHook.drive.stop(app);
    await expect
      .poll(async () => (await testHook.getState(app)).phase, { intervals: [25] })
      .toBe("transcribing");
    await expect
      .poll(async () => (await testHook.getState(app)).phase, { intervals: [25] })
      .toBe("delivering");

    const state = await testHook.getState(app);
    if (state.phase === "delivering") {
      expect(state.text).toBe(MOCK_TRANSCRIPT);
    }

    // A history row was written with the engine metadata.
    await expect.poll(async () => (await testHook.history.getRecent(app)).length).toBe(1);
    const recent = await testHook.history.getRecent(app);
    expect(recent[0]?.text).toBe(MOCK_TRANSCRIPT);
    expect(recent[0]?.engineId).toBe("mock");
    expect(recent[0]?.modelId).toBe("mock-v1");
    // durationMs is wall-clock capture time, not fixture length.
    expect(recent[0]?.durationMs).toBeGreaterThanOrEqual(1000);

    // Auto-dismiss returns to idle.
    await expect.poll(async () => (await testHook.getState(app)).phase).toBe("idle");
  } finally {
    await close();
  }

  expect(consoleErrors).toEqual([]);
});
