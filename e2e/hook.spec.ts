import { expect, test } from "@playwright/test";
import { launchApp, testHook } from "./helpers/launch";

/**
 * The Phase 2 hypothesis verification: uiohook-napi may stop firing after
 * getUserMedia initialises while an Electron window is focused
 * (SnosMe/uiohook-napi#54). The plan requires ten consecutive capture
 * cycles with the main window focused before building on top of the hidden
 * recorder window. This spec proves it with synthesized press-and-hold
 * cycles through the real hook, plus a real microphone capture.
 */

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

test("the keyboard hook survives ten capture cycles after getUserMedia", async () => {
  const { app, consoleErrors, close } = await launchApp(
    {
      STRUQ_VOICE_E2E: "0",
      STRUQ_VOICE_HOOK_TEST: "1"
    },
    // This spec proves the hook survives real focus and real key events;
    // headless mode has neither.
    { headless: false }
  );

  try {
    // The recorder window acquires the microphone at boot (real getUserMedia,
    // because hook-test mode does not skip it).
    let live = false;
    for (let i = 0; i < 100 && !live; i++) {
      live = await testHook.recorder.isLive(app);
      if (!live) await sleep(100);
    }
    test.skip(!live, "no microphone available on this machine");

    // Reproduce the reported failure mode: the main window has OS focus
    // while the stream is live and the hook is running.
    await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find(
        (window) =>
          !window.webContents.getURL().includes("recorder") &&
          !window.webContents.getURL().includes("overlay")
      );
      main?.focus();
    });
    await sleep(200);

    // Ten full capture cycles, each driven by a synthesized hold through the
    // real keyboard hook. The tenth cycle firing proves the hook survived
    // getUserMedia while the main window was focused.
    for (let cycle = 1; cycle <= 10; cycle++) {
      await testHook.keyboard.pressAndHold(app);
      await expect
        .poll(async () => (await testHook.getState(app)).phase, { intervals: [25] })
        .toBe("listening");
      await sleep(450);
      await testHook.keyboard.releaseHold(app);
      await expect
        .poll(async () => (await testHook.getState(app)).phase, { intervals: [25] })
        .toBe("transcribing");
      await expect
        .poll(async () => (await testHook.getState(app)).phase)
        .toBe("idle");
    }

    // The last cycle produced real audio; verify the WAV container.
    const wav = await testHook.getLastCaptureWav(app);
    expect(wav).not.toBeNull();
    if (wav === null) return;
    const bytes = Buffer.from(wav.base64, "base64");
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WAVE");
    // At least the 450ms hold plus pre-roll.
    expect(wav.durationMs).toBeGreaterThan(400);
  } finally {
    await close();
  }

  expect(consoleErrors).toEqual([]);
});
