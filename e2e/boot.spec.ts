import { expect, test } from "@playwright/test";
import { launchApp } from "./helpers/launch";

test("boots to the main window with zero console errors", async () => {
  const { app, window, consoleErrors, close } = await launchApp();

  try {
    // First window and correct title within 10s.
    await expect(window).toHaveTitle("Struq Voice", { timeout: 10_000 });

    const ready = await app.evaluate(({ app }) => app.isReady());
    expect(ready).toBe(true);

    // The skeleton has exactly one window: the main window.
    expect(app.windows()).toHaveLength(1);

    // The theme is actually applied: the wordmark renders and the body uses
    // the linen background, not the white browser default.
    await expect(window.locator("h1")).toHaveText("Struq Voice");
    const bodyBackground = await window.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    expect(bodyBackground).not.toBe("rgba(0, 0, 0, 0)");
    expect(bodyBackground).not.toBe("rgb(255, 255, 255)");

    // A clean Electron boot emits no console errors. This gate is the point.
    expect(consoleErrors).toEqual([]);

    await window.screenshot({ path: "test-results/screenshots/boot.png" });
  } finally {
    await close();
  }
});
