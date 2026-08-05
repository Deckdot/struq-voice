import { expect, test } from "@playwright/test";
import { launchApp, testHook } from "./helpers/launch";

const EXPECTED_IDS = [
  "startStop",
  "recent",
  "engine",
  "open",
  "settings",
  "pauseHotkeys",
  "quit"
];

test("tray exists with the expected menu and reflects capture state", async () => {
  const { app, consoleErrors, close } = await launchApp();

  try {
    const ids = await testHook.tray.getMenuItemIds(app);
    for (const id of EXPECTED_IDS) {
      expect(ids).toContain(id);
    }

    // Idle tooltip carries state and engine.
    expect(await testHook.tray.getTooltip(app)).toContain("idle");
    expect(await testHook.tray.getTooltip(app)).toContain("Mock");

    // Left click toggles capture; the tray state follows the session.
    await testHook.drive.start(app);
    await expect.poll(async () => testHook.tray.getTooltip(app)).toContain("recording");

    await new Promise((resolve) => setTimeout(resolve, 500));
    await testHook.drive.stop(app);

    await expect
      .poll(async () => testHook.tray.getTooltip(app), { intervals: [25] })
      .toContain("transcribing");
    await expect.poll(async () => testHook.tray.getTooltip(app)).toContain("idle");
  } finally {
    await close();
  }

  expect(consoleErrors).toEqual([]);
});
