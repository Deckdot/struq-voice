import { expect, test, type Page } from "@playwright/test";
import { launchApp } from "./helpers/launch";

/**
 * The main window UI: navigation, every view, and the controls that cross IPC.
 * The capture pipeline is covered by overlay/transcribe; this file is about
 * what the user actually sees and clicks.
 *
 * Several assertions here are regressions for bugs that shipped: the mic list
 * arriving empty, the first-run banner covering the last settings controls,
 * and the whisper catalog carrying only two entries.
 */

/** The first-run banner is fixed to the bottom; dismiss it before clicking. */
const dismissFirstRun = async (window: Page): Promise<void> => {
  const dismiss = window.getByRole("button", { name: "Dismiss" });
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click();
  }
};

const goTo = async (window: Page, route: string): Promise<void> => {
  await window.getByRole("button", { name: route, exact: true }).first().click();
};

test("every view renders and the rail navigates between them", async () => {
  const { window, consoleErrors, close } = await launchApp();

  try {
    await expect(window).toHaveTitle("Struq Voice", { timeout: 10_000 });
    await dismissFirstRun(window);

    // Dictate is the landing route.
    await expect(window.getByRole("heading", { name: "Struq Voice" })).toBeVisible();

    for (const [route, heading] of [
      ["History", "History"],
      ["Models", "Models"],
      ["Settings", "Settings"],
      ["Dictate", "Struq Voice"]
    ] as const) {
      await goTo(window, route);
      await expect(
        window.getByRole("heading", { name: heading, exact: true }).first()
      ).toBeVisible();
    }

    expect(consoleErrors).toEqual([]);
  } finally {
    await close();
  }
});

test("settings shows the real microphone list", async () => {
  const { window, consoleErrors, close } = await launchApp();

  try {
    await dismissFirstRun(window);
    await goTo(window, "Settings");

    const mic = window
      .locator("section")
      .filter({ has: window.getByRole("heading", { name: "Microphone" }) })
      .locator("select");
    await expect(mic).toBeVisible();

    // The recorder answers the enumeration request, so the list is populated.
    // It arrived empty when the preload and main disagreed on the payload shape.
    await expect
      .poll(async () => mic.locator("option").count(), { timeout: 10_000 })
      .toBeGreaterThan(0);
    await expect(mic.locator("option").first()).not.toHaveText("No microphones found");

    expect(consoleErrors).toEqual([]);
  } finally {
    await close();
  }
});

test("every settings control is reachable and applies", async () => {
  const { window, consoleErrors, close } = await launchApp();

  try {
    await dismissFirstRun(window);
    await goTo(window, "Settings");

    // Each delivery checkbox toggles and the new value survives a round trip
    // through the settings store. The last two sat under the first-run banner.
    const boxes = window.locator("input[type=checkbox]");
    const count = await boxes.count();
    expect(count).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const box = boxes.nth(index);
      const before = await box.isChecked();
      await box.click({ timeout: 5000 });
      await expect(box).toBeChecked({ checked: !before });
    }

    expect(consoleErrors).toEqual([]);
  } finally {
    await close();
  }
});

test("selecting an engine persists and reveals its options", async () => {
  const { window, consoleErrors, close } = await launchApp();

  try {
    await dismissFirstRun(window);
    await goTo(window, "Settings");

    for (const id of ["parakeet", "openrouter", "whisper-cpp"]) {
      const radio = window.locator(`input[type=radio][value="${id}"]`);
      await radio.click();
      await expect(radio).toBeChecked();
    }

    // Whisper is selected, so its model picker appears with the full catalog.
    const picker = window
      .locator("section")
      .filter({ has: window.getByRole("heading", { name: "Whisper model" }) })
      .locator("select");
    await expect(picker).toBeVisible();
    await expect
      .poll(async () => picker.locator("option").count())
      .toBeGreaterThan(20);

    // Choosing a different size sticks.
    await picker.selectOption("whisper-small-q5_1");
    await expect(picker).toHaveValue("whisper-small-q5_1");

    // Switching away hides the picker again.
    await window.locator('input[type=radio][value="parakeet"]').click();
    await expect(picker).toBeHidden();

    expect(consoleErrors).toEqual([]);
  } finally {
    await close();
  }
});

test("models lists the full whisper catalog and filters by size", async () => {
  const { window, consoleErrors, close } = await launchApp();

  try {
    await dismissFirstRun(window);
    await goTo(window, "Models");

    // The runtime card plus a card per catalog model.
    const cards = window.locator("article");
    await expect.poll(async () => cards.count(), { timeout: 10_000 }).toBeGreaterThan(20);

    const unfiltered = await cards.count();

    // Every size tier filters to a strict subset, and back to all.
    for (const tier of ["Tiny", "Base", "Small", "Medium", "Large"]) {
      await window.getByRole("button", { name: tier, exact: true }).click();
      const filtered = await cards.count();
      expect(filtered).toBeGreaterThan(1);
      expect(filtered).toBeLessThan(unfiltered);
    }

    await window.getByRole("button", { name: "All sizes", exact: true }).click();
    await expect.poll(async () => cards.count()).toBe(unfiltered);

    expect(consoleErrors).toEqual([]);
  } finally {
    await close();
  }
});

test("settings shows the update panel and the running version", async () => {
  const { window, consoleErrors, close } = await launchApp();

  try {
    await dismissFirstRun(window);
    await goTo(window, "Settings");

    const updates = window
      .locator("section")
      .filter({ has: window.getByRole("heading", { name: "Updates" }) });
    await expect(updates).toBeVisible();

    // The running version comes from the main process, so an empty string here
    // means the IPC never answered.
    await expect(updates.getByText(/^Version \d/)).toBeVisible();

    // Under e2e there is no updater, so the check is a no-op that must still
    // leave the button usable rather than spinning forever.
    const check = updates.getByRole("button", { name: "Check for updates" });
    await expect(check).toBeVisible();
    await check.click();
    await expect(check).toBeEnabled({ timeout: 10_000 });

    expect(consoleErrors).toEqual([]);
  } finally {
    await close();
  }
});

test("the command palette opens and navigates", async () => {
  const { window, consoleErrors, close } = await launchApp();

  try {
    await dismissFirstRun(window);
    await window.keyboard.press("Control+k");

    // cmdk renders a plain container, so the input identifies the palette.
    const input = window.getByPlaceholder("Type a command or search...");
    await expect(input).toBeVisible();

    await input.fill("models");
    await window.keyboard.press("Enter");

    await expect(window.getByRole("heading", { name: "Models", exact: true })).toBeVisible();
    await expect(input).toBeHidden();

    // Escape closes it again without navigating. The handler lives on the
    // palette, so the key has to be pressed while it holds focus.
    await window.keyboard.press("Control+k");
    await expect(input).toBeVisible();
    await input.press("Escape");
    await expect(input).toBeHidden();
    await expect(window.getByRole("heading", { name: "Models", exact: true })).toBeVisible();

    expect(consoleErrors).toEqual([]);
  } finally {
    await close();
  }
});

test("history renders its empty state before any capture", async () => {
  const { window, consoleErrors, close } = await launchApp();

  try {
    await dismissFirstRun(window);
    await goTo(window, "History");

    await expect(window.getByRole("heading", { name: "History" })).toBeVisible();
    // A search box is present whether or not there are rows. It is
    // type="search", so the role is searchbox rather than textbox.
    const search = window.getByPlaceholder("Search transcripts...");
    await expect(search).toBeVisible();

    // Empty profile, so the empty state explains itself.
    await expect(window.getByText("No transcripts yet.")).toBeVisible();

    // Searching with no rows swaps to the no-match copy.
    await search.fill("nothing matches this");
    await expect(window.getByText("Nothing matches that search.")).toBeVisible();

    expect(consoleErrors).toEqual([]);
  } finally {
    await close();
  }
});

test("the window renders the theme, not the browser default", async () => {
  const { window, consoleErrors, close } = await launchApp();

  try {
    await dismissFirstRun(window);

    // Guards the dev-server regression that rendered a blank white 404 page.
    const background = await window.evaluate(
      () => getComputedStyle(document.body).backgroundColor
    );
    expect(background).not.toBe("rgba(0, 0, 0, 0)");
    expect(background).not.toBe("rgb(255, 255, 255)");

    // The app mounted rather than leaving an empty root.
    const mounted = await window.evaluate(
      () => (document.getElementById("root")?.children.length ?? 0) > 0
    );
    expect(mounted).toBe(true);

    expect(consoleErrors).toEqual([]);
  } finally {
    await close();
  }
});
