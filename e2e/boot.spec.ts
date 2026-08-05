import { expect, test } from "@playwright/test";
import { launchApp, testHook } from "./helpers/launch";

test("boots to the main window with zero console errors", async () => {
  const { app, window, consoleErrors, close } = await launchApp();

  try {
    // First window and correct title within 10s.
    await expect(window).toHaveTitle("Struq Voice", { timeout: 10_000 });

    const ready = await app.evaluate(({ app }) => app.isReady());
    expect(ready).toBe(true);

    // Two windows at boot: the main window and the hidden recorder window.
    // The overlay is created lazily on the first capture.
    expect(app.windows()).toHaveLength(2);

    // The recorder window exists but is never visible.
    expect(await testHook.recorder.isVisible(app)).toBe(false);

    // The theme is actually applied: the landing view renders and the body
    // uses the linen background, not the white browser default. Onboarding is
    // marked complete under e2e, so Dictate is what boot lands on.
    await expect(window.locator("h1")).toHaveText("Dictate");
    await expect(
      window.getByRole("navigation", { name: "Struq Voice" }).getByText("Struq Voice")
    ).toBeVisible();
    const bodyBackground = await window.evaluate(
      () => getComputedStyle(document.body).backgroundColor
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
