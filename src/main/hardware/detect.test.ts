import { describe, expect, it } from "vitest";
import { detectHardware } from "./detect";
import type { HardwareDetectDeps } from "./detect";
import { classifyMachine } from "../../shared/hardware";

/**
 * Detection runs during boot, so the tests that matter are the failure ones:
 * every probe must degrade to a usable profile rather than throw. The GPU
 * parsing is pinned separately because the shape comes from Chromium and is
 * the part most likely to drift.
 */

const detect = (deps: HardwareDetectDeps): ReturnType<typeof detectHardware> =>
  detectHardware({ runtimeRoot: "C:/nowhere", deps });

const eightCores = (): readonly { model: string }[] =>
  Array.from({ length: 8 }, () => ({ model: "AMD Ryzen 7 5800X" }));

describe("detectHardware", () => {
  it("reads cores, model and memory", async () => {
    const profile = await detect({
      cpus: eightCores,
      totalmem: () => 16 * 1024 * 1024 * 1024,
      getGPUInfo: () => Promise.resolve({}),
      cudaRuntime: () => false
    });
    expect(profile.cpuCores).toBe(8);
    expect(profile.cpuModel).toBe("AMD Ryzen 7 5800X");
    expect(profile.totalMemGb).toBe(16);
  });

  it("identifies an NVIDIA card by PCI vendor id", async () => {
    const profile = await detect({
      cpus: eightCores,
      totalmem: () => 16 * 1024 * 1024 * 1024,
      getGPUInfo: () =>
        Promise.resolve({
          gpuDevice: [{ vendorId: 0x10de, active: true }],
          auxAttributes: { glRenderer: "NVIDIA GeForce RTX 4070" }
        }),
      cudaRuntime: () => true
    });
    expect(profile.gpuVendor).toBe("nvidia");
    expect(profile.gpuName).toBe("NVIDIA GeForce RTX 4070");
    expect(profile.cudaRuntime).toBe(true);
  });

  // Laptops report the integrated chip alongside the discrete card. Taking
  // the first entry would call an RTX machine "intel".
  it("prefers the active GPU over the first listed", async () => {
    const profile = await detect({
      cpus: eightCores,
      totalmem: () => 16 * 1024 * 1024 * 1024,
      getGPUInfo: () =>
        Promise.resolve({
          gpuDevice: [
            { vendorId: 0x8086, active: false },
            { vendorId: 0x10de, active: true }
          ]
        }),
      cudaRuntime: () => false
    });
    expect(profile.gpuVendor).toBe("nvidia");
  });

  it("falls back to the renderer string when no vendor id is present", async () => {
    const profile = await detect({
      cpus: eightCores,
      totalmem: () => 16 * 1024 * 1024 * 1024,
      getGPUInfo: () => Promise.resolve({ auxAttributes: { glRenderer: "AMD Radeon RX 7800" } }),
      cudaRuntime: () => false
    });
    expect(profile.gpuVendor).toBe("amd");
  });

  it("survives a rejected GPU probe", async () => {
    const profile = await detect({
      cpus: eightCores,
      totalmem: () => 16 * 1024 * 1024 * 1024,
      getGPUInfo: () => Promise.reject(new Error("no gpu process")),
      cudaRuntime: () => false
    });
    expect(profile.gpuVendor).toBe("unknown");
    expect(profile.cpuCores).toBe(8);
  });

  it("survives a throwing cpu probe", async () => {
    const profile = await detect({
      cpus: () => {
        throw new Error("os unavailable");
      },
      totalmem: () => 0,
      getGPUInfo: () => Promise.resolve({}),
      cudaRuntime: () => false
    });
    expect(profile.cpuCores).toBeGreaterThan(0);
    expect(classifyMachine(profile)).toBe("balanced");
  });

  it("survives a throwing cuda probe", async () => {
    const profile = await detect({
      cpus: eightCores,
      totalmem: () => 16 * 1024 * 1024 * 1024,
      getGPUInfo: () => Promise.resolve({}),
      cudaRuntime: () => {
        throw new Error("fs denied");
      }
    });
    expect(profile.cudaRuntime).toBe(false);
  });

  it("returns a profile that always parses", async () => {
    const profile = await detect({
      cpus: () => [],
      totalmem: () => 0,
      getGPUInfo: () => Promise.resolve(null),
      cudaRuntime: () => false
    });
    expect(profile.cpuCores).toBeGreaterThanOrEqual(1);
    expect(profile.gpuName).toBeNull();
  });
});
