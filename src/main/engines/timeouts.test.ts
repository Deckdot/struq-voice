import { describe, expect, it } from "vitest";
import { MAX_TRANSCRIBE_TIMEOUT_MS, transcribeTimeoutMs } from "./timeouts";

/**
 * The regression this file exists for: a fixed 20 second local budget aborted
 * every capture past roughly half a minute of speech, and the abort threw the
 * transcript away rather than delivering it.
 */
describe("transcribe timeout budget", () => {
  it("gives a five minute recording far more than the old fixed 20 seconds", () => {
    expect(transcribeTimeoutMs("local", 300_000)).toBeGreaterThan(300_000);
  });

  it("grows with the length of the audio", () => {
    const short = transcribeTimeoutMs("local", 5_000);
    const long = transcribeTimeoutMs("local", 120_000);
    expect(long).toBeGreaterThan(short);
  });

  it("still allows a short capture a generous startup allowance", () => {
    expect(transcribeTimeoutMs("local", 0)).toBeGreaterThanOrEqual(30_000);
    expect(transcribeTimeoutMs("cloud", 0)).toBeGreaterThanOrEqual(60_000);
  });

  it("gives cloud more startup than local, because it has to upload first", () => {
    expect(transcribeTimeoutMs("cloud", 0)).toBeGreaterThan(
      transcribeTimeoutMs("local", 0)
    );
  });

  it("never waits forever, so a hung engine releases the session", () => {
    expect(transcribeTimeoutMs("local", 60 * 60_000)).toBe(
      MAX_TRANSCRIBE_TIMEOUT_MS
    );
  });

  it("treats a missing or nonsense duration as zero rather than NaN", () => {
    expect(transcribeTimeoutMs("local", Number.NaN)).toBe(
      transcribeTimeoutMs("local", 0)
    );
    expect(transcribeTimeoutMs("local", -5_000)).toBe(
      transcribeTimeoutMs("local", 0)
    );
  });
});
