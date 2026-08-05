import { expect, test } from "@playwright/test";
import { launchApp, testHook } from "./helpers/launch";

test("overlay shows on capture start, holds its properties, hides on completion", async () => {
  const { app, consoleErrors, close } = await launchApp();

  try {
    // Lazily created: no overlay window before the first capture.
    expect(await testHook.overlay.exists(app)).toBe(false);

    await testHook.drive.start(app);

    await expect.poll(async () => testHook.overlay.exists(app)).toBe(true);
    expect(await testHook.overlay.isFocusable(app)).toBe(false);
    expect(await testHook.overlay.isSkipTaskbar(app)).toBe(true);
    expect(await testHook.overlay.isAlwaysOnTop(app)).toBe(true);
    expect(await testHook.overlay.isVisible(app)).toBe(true);

    await expect.poll(async () => (await testHook.getState(app)).phase).toBe("listening");

    // Exceed minCaptureMs (350ms) so the capture is not silently discarded.
    await new Promise((resolve) => setTimeout(resolve, 500));

    await testHook.drive.stop(app);

    // The full journey: transcribing, delivering, then idle (auto-dismiss).
    await expect
      .poll(async () => (await testHook.getState(app)).phase, { intervals: [25] })
      .toBe("transcribing");
    await expect
      .poll(async () => (await testHook.getState(app)).phase, { intervals: [25] })
      .toBe("delivering");
    await expect
      .poll(async () => (await testHook.getState(app)).phase)
      .toBe("idle");

    // Auto-dismiss hides the overlay.
    expect(await testHook.overlay.isVisible(app)).toBe(false);
  } finally {
    await close();
  }

  expect(consoleErrors).toEqual([]);
});

test("overlay shows the error state and recovers to idle", async () => {
  const { app, consoleErrors, close } = await launchApp();

  try {
    await testHook.drive.start(app);
    await expect.poll(async () => testHook.overlay.exists(app)).toBe(true);
    await expect.poll(async () => (await testHook.getState(app)).phase).toBe("listening");

    await testHook.drive.fail(app, "Mic disconnected. Replug the microphone and try again.");
    await expect.poll(async () => (await testHook.getState(app)).phase).toBe("error");
    expect(await testHook.overlay.isVisible(app)).toBe(true);

    // Error auto-dismisses back to idle, hiding the overlay.
    await expect.poll(async () => (await testHook.getState(app)).phase).toBe("idle");
    expect(await testHook.overlay.isVisible(app)).toBe(false);
  } finally {
    await close();
  }

  expect(consoleErrors).toEqual([]);
});

test("a tap shorter than minCaptureMs is silently discarded", async () => {
  const { app, consoleErrors, close } = await launchApp();

  try {
    await testHook.drive.start(app);
    await expect.poll(async () => (await testHook.getState(app)).phase).toBe("listening");
    // Stop well under the 350ms threshold.
    await testHook.drive.stop(app);
    await expect.poll(async () => (await testHook.getState(app)).phase).toBe("idle");
    expect(await testHook.overlay.isVisible(app)).toBe(false);
  } finally {
    await close();
  }

  expect(consoleErrors).toEqual([]);
});

test("cancel (Escape equivalent) aborts a capture", async () => {
  const { app, consoleErrors, close } = await launchApp();

  try {
    await testHook.drive.start(app);
    await expect.poll(async () => (await testHook.getState(app)).phase).toBe("listening");
    await new Promise((resolve) => setTimeout(resolve, 400));
    await testHook.drive.cancel(app);
    await expect.poll(async () => (await testHook.getState(app)).phase).toBe("idle");
    expect(await testHook.overlay.isVisible(app)).toBe(false);
  } finally {
    await close();
  }

  expect(consoleErrors).toEqual([]);
});
