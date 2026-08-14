import { describe, expect, it } from "vitest";
import {
  DEFAULT_WHISPER_MODEL_ID,
  MODEL_CATALOG,
  WHISPER_TIER_ORDER,
  findModel,
  whisperVariant
} from "./models";

/**
 * Catalog integrity. Sizes and sha256 hashes come from the Hugging Face API
 * tree, so these tests guard the shape and the wiring rather than re-checking
 * the upstream numbers: a bad id or a missing hash breaks the downloader's
 * verification step, which is the whole point of publishing hashes.
 */

const whisper = MODEL_CATALOG.filter((model) => model.engine === "whisper-cpp");

describe("model catalog", () => {
  it("has unique ids", () => {
    const ids = MODEL_CATALOG.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every whisper size tier", () => {
    const tiers = new Set(
      whisper.map((model) => whisperVariant(model.id)?.tier).filter((tier) => tier !== undefined)
    );
    for (const tier of WHISPER_TIER_ORDER) {
      expect(tiers.has(tier)).toBe(true);
    }
  });

  it("offers both a small and a large whisper build", () => {
    const bytes = whisper.map((model) => model.bytes);
    expect(Math.min(...bytes)).toBeLessThan(50_000_000);
    expect(Math.max(...bytes)).toBeGreaterThan(3_000_000_000);
  });

  // Every file in the catalog, not just whisper. Scoping this to whisper is
  // how both parakeet tokens.txt entries kept an all-zero placeholder, which
  // the downloader and the installer both read as "skip verification": a
  // truncated vocab then passed as installed and only failed at first decode.
  it("gives every model file a real sha256", () => {
    for (const model of MODEL_CATALOG) {
      for (const file of model.files) {
        expect(file.sha256, `${model.id}/${file.path}`).toMatch(/^[0-9a-f]{64}$/);
        expect(file.sha256, `${model.id}/${file.path}`).not.toMatch(/^0{64}$/);
      }
    }
  });

  it("declares a total size matching the sum of its files", () => {
    for (const model of MODEL_CATALOG) {
      const summed = model.files.reduce((total, file) => total + file.bytes, 0);
      expect(summed).toBe(model.bytes);
    }
  });

  // The exact resolve url matters: an extra path segment still ends with the
  // file name and still contains the repo, but 404s on every download.
  it("builds the exact whisper.cpp resolve url", () => {
    for (const model of whisper) {
      for (const file of model.files) {
        expect(file.url).toBe(
          `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file.path}`
        );
      }
    }
  });

  it("builds the exact parakeet resolve url", () => {
    const parakeet = MODEL_CATALOG.filter((model) => model.engine === "parakeet");
    for (const model of parakeet) {
      for (const file of model.files) {
        expect(file.url).toMatch(
          /^https:\/\/huggingface\.co\/csukuangfj\/[^/]+\/resolve\/main\/[^/]+$/
        );
        expect(file.url.endsWith(file.path)).toBe(true);
      }
    }
  });

  it("never doubles a path segment in a model url", () => {
    for (const model of MODEL_CATALOG) {
      for (const file of model.files) {
        const afterHost = file.url.replace("https://huggingface.co/", "");
        expect(afterHost.split("/resolve/main/")).toHaveLength(2);
        expect(afterHost).not.toContain(`${file.path}/`);
      }
    }
  });

  it("resolves the default whisper model", () => {
    const model = findModel(DEFAULT_WHISPER_MODEL_ID);
    expect(model).not.toBeNull();
    expect(model?.engine).toBe("whisper-cpp");
  });

  // The default is what a fresh install downloads, so it must stay small
  // enough to be reasonable on any machine.
  it("keeps the default whisper model small", () => {
    const model = findModel(DEFAULT_WHISPER_MODEL_ID);
    expect(model?.bytes ?? Infinity).toBeLessThan(200_000_000);
  });

  it("marks English-only builds and leaves multilingual ones unmarked", () => {
    const english = whisper.filter((model) => whisperVariant(model.id)?.englishOnly === true);
    expect(english.length).toBeGreaterThan(0);
    for (const model of english) {
      expect(model.languages).toBe("English only");
      expect(model.name).toContain("English-only");
    }
  });

  it("returns null for an unknown model id", () => {
    expect(findModel("nope")).toBeNull();
    expect(whisperVariant("nope")).toBeNull();
  });

  it("names the ggml file after the model id", () => {
    for (const model of whisper) {
      const variant = whisperVariant(model.id);
      expect(variant).not.toBeNull();
      expect(model.files[0]?.path).toBe(variant?.fileName);
    }
  });
});
