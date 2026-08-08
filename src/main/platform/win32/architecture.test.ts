import { describe, expect, it } from "vitest";
import { getArchitectureSupportError } from "./architecture";

describe("Windows architecture support", () => {
  it("allows x64 and reports unsupported Windows architectures clearly", () => {
    expect(getArchitectureSupportError("win32", "x64")).toBeNull();
    expect(getArchitectureSupportError("linux", "arm64")).toBeNull();
    expect(getArchitectureSupportError("win32", "ia32")).toMatchObject({
      title: "Struq Voice requires 64-bit Windows"
    });
    expect(getArchitectureSupportError("win32", "arm64")?.message).toContain("arm64");
  });
});
