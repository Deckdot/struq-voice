/**
 * The settings store owns the one file that holds everything the user has
 * configured. Its failure modes are all silent by nature: a bad read resets
 * a profile, a bad write pretends to have saved. Both used to happen.
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSettingsStore } from "./settings-store";

const freshFile = (): string =>
  join(mkdtempSync(join(tmpdir(), "struq-settings-")), "settings.json");

const configured = {
  version: 1,
  theme: "dark",
  pttAccelerator: "Alt+X",
  speechLanguage: "nl",
  post: {
    dictionary: [
      { from: "struck", to: "Struq", matchCase: false, wholeWord: true, enabled: true }
    ],
    removeFillers: true,
    addTrailingPunctuation: false
  },
  onboarding: { completed: true, completedVersion: 1, hardware: null }
};

describe("settings store reads", () => {
  it("loads a valid file", () => {
    const file = freshFile();
    writeFileSync(file, JSON.stringify(configured), "utf-8");

    const store = createSettingsStore(file);

    expect(store.get().theme).toBe("dark");
    expect(store.get().pttAccelerator).toBe("Alt+X");
    expect(store.get().post.dictionary).toHaveLength(1);
  });

  /**
   * The whole-object parse is all-or-nothing, so one value the schema no
   * longer accepts used to discard every other setting in the file and the
   * next write committed that loss for good.
   */
  it("keeps every valid field when one field is invalid", () => {
    const file = freshFile();
    writeFileSync(file, JSON.stringify({ ...configured, theme: "purple" }), "utf-8");

    const store = createSettingsStore(file);

    expect(store.get().pttAccelerator).toBe("Alt+X");
    expect(store.get().speechLanguage).toBe("nl");
    expect(store.get().post.dictionary).toHaveLength(1);
    expect(store.get().onboarding.completed).toBe(true);
    // Only the rejected field falls back.
    expect(store.get().theme).toBe("system");
  });

  it("falls back to defaults when the file is not settings at all", () => {
    const file = freshFile();
    writeFileSync(file, '"not settings"', "utf-8");

    expect(createSettingsStore(file).get().theme).toBe("system");
  });

  it("uses defaults when there is no file", () => {
    expect(createSettingsStore(freshFile()).get().theme).toBe("system");
  });
});

describe("settings store writes", () => {
  it("persists an update", () => {
    const file = freshFile();
    const store = createSettingsStore(file);

    store.update({ theme: "dark" });

    expect(createSettingsStore(file).get().theme).toBe("dark");
    expect(store.lastWriteError()).toBeNull();
  });

  /**
   * A direct write leaves a truncated file behind if the process dies
   * mid-save, and a truncated file cannot be parsed at all, so the salvage
   * on the read path cannot rescue it. Writing to a temp file and renaming
   * means a reader sees either the old file or the new one.
   */
  it("never leaves the settings file partially written", () => {
    const file = freshFile();
    const store = createSettingsStore(file);
    store.update({ theme: "dark" });

    store.update({ speechLanguage: "nl" });

    const raw = readFileSync(file, "utf-8");
    expect(() => JSON.parse(raw) as unknown).not.toThrow();
    expect(store.lastWriteError()).toBeNull();
  });

  /**
   * A write that fails must not pass for success. The change still applies
   * for this session, and the UI is told so it can say the change will not
   * survive a restart.
   */
  it("reports a write failure instead of swallowing it", () => {
    // A directory where the file should be: the write cannot succeed.
    const dir = mkdtempSync(join(tmpdir(), "struq-settings-"));
    const store = createSettingsStore(join(dir, "settings.json"));

    store.update({ theme: "dark" });
    const failing = createSettingsStore(dir);
    failing.update({ theme: "light" });

    expect(failing.lastWriteError()).not.toBeNull();
    // The value still applies in memory for this session.
    expect(failing.get().theme).toBe("light");
  });

  it("notifies subscribers on update", () => {
    const store = createSettingsStore(freshFile());
    const seen: string[] = [];
    const unsubscribe = store.subscribe((next) => seen.push(next.theme));

    store.update({ theme: "dark" });
    unsubscribe();
    store.update({ theme: "light" });

    expect(seen).toEqual(["dark"]);
  });
});
