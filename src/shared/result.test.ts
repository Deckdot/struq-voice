import { describe, expect, it } from "vitest";
import { fail, ok } from "./result";

describe("result", () => {
  it("constructs a success result carrying the value", () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });

  it("constructs a failure result carrying the error", () => {
    const error = { code: "UNKNOWN" as const, message: "boom" };
    const result = fail(error);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(error);
    }
  });
});
