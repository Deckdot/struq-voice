/**
 * Machine probing. Node's os module for cores and memory, Electron's GPU
 * info for the card, and the whisper.cpp CUDA runtime check for whether that
 * card is actually usable. Nothing shells out: nvidia-smi and WMI can hang
 * for seconds on some machines, and this runs during boot.
 *
 * Detection never blocks boot. Every probe degrades to the unknown profile,
 * which classifies as balanced and still yields a working recommendation.
 */

import { cpus, totalmem } from "node:os";
import { app } from "electron";
import type { GpuVendor, HardwareProfile } from "../../shared/hardware";
import { UNKNOWN_HARDWARE, hardwareProfileSchema } from "../../shared/hardware";
import { hasCudaRuntime } from "../engines/whisper-cpp";

const BYTES_PER_GB = 1024 * 1024 * 1024;

/** Shape of the subset of app.getGPUInfo("basic") we read. */
interface BasicGpuInfo {
  readonly gpuDevice?: readonly {
    readonly vendorId?: number;
    readonly deviceId?: number;
    readonly active?: boolean;
  }[];
  readonly auxAttributes?: Record<string, unknown>;
}

export interface HardwareDetectDeps {
  readonly cpus?: () => readonly { model: string }[];
  readonly totalmem?: () => number;
  readonly getGPUInfo?: (kind: "basic") => Promise<unknown>;
  readonly cudaRuntime?: () => boolean;
}

export interface HardwareDetectOptions {
  /** userData/runtimes; the CUDA DLL sits under whisper-cpp/. */
  readonly runtimeRoot: string;
  readonly deps?: HardwareDetectDeps;
}

/** PCI vendor ids. These are stable and the only reliable field in gpuDevice. */
const PCI_VENDORS: Record<number, GpuVendor> = {
  0x10de: "nvidia",
  0x1002: "amd",
  0x1022: "amd",
  0x8086: "intel",
  0x106b: "apple"
};

const vendorFromName = (name: string): GpuVendor => {
  const lower = name.toLowerCase();
  if (lower.includes("nvidia") || lower.includes("geforce") || lower.includes("rtx")) {
    return "nvidia";
  }
  if (lower.includes("amd") || lower.includes("radeon")) return "amd";
  if (lower.includes("intel") || lower.includes("arc")) return "intel";
  if (lower.includes("apple")) return "apple";
  return "unknown";
};

/**
 * The device description lives in auxAttributes under a key that has moved
 * between Chromium versions, so read the known candidates rather than one.
 */
const readGpuName = (aux: Record<string, unknown> | undefined): string | null => {
  if (aux === undefined) return null;
  for (const key of ["glRenderer", "gpuDeviceDescription", "glVendor"]) {
    const value = aux[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
};

const parseGpu = (info: unknown): { vendor: GpuVendor; name: string | null } => {
  if (typeof info !== "object" || info === null) return { vendor: "unknown", name: null };
  const basic = info as BasicGpuInfo;

  const name = readGpuName(basic.auxAttributes);

  // Prefer the active device: laptops report both the integrated and the
  // discrete card, and the integrated one is usually listed first.
  const devices = basic.gpuDevice ?? [];
  const device = devices.find((candidate) => candidate.active === true) ?? devices[0];
  const byId = device?.vendorId !== undefined ? PCI_VENDORS[device.vendorId] : undefined;
  if (byId !== undefined) return { vendor: byId, name };

  return { vendor: name !== null ? vendorFromName(name) : "unknown", name };
};

/**
 * Probe the machine once. Returns the unknown profile rather than throwing
 * when a probe fails, so a boot on unusual hardware still gets a
 * recommendation.
 */
export const detectHardware = async (
  options: HardwareDetectOptions
): Promise<HardwareProfile> => {
  const readCpus = options.deps?.cpus ?? cpus;
  const readMem = options.deps?.totalmem ?? totalmem;
  const readGpu = options.deps?.getGPUInfo ?? ((kind: "basic") => app.getGPUInfo(kind));
  const readCuda = options.deps?.cudaRuntime ?? (() => hasCudaRuntime(options.runtimeRoot));

  let cpuCores = UNKNOWN_HARDWARE.cpuCores;
  let cpuModel = UNKNOWN_HARDWARE.cpuModel;
  let totalMemGb = UNKNOWN_HARDWARE.totalMemGb;
  try {
    const cores = readCpus();
    if (cores.length > 0) {
      cpuCores = cores.length;
      cpuModel = cores[0]?.model.trim() ?? UNKNOWN_HARDWARE.cpuModel;
    }
    totalMemGb = Math.round(readMem() / BYTES_PER_GB);
  } catch {
    // Keep the unknown defaults.
  }

  let vendor: GpuVendor = "unknown";
  let gpuName: string | null = null;
  try {
    const parsed = parseGpu(await readGpu("basic"));
    vendor = parsed.vendor;
    gpuName = parsed.name;
  } catch {
    // GPU info is unavailable headless and under some drivers. Not fatal:
    // the recommendation falls back to cores and memory.
  }

  let cudaRuntime = false;
  try {
    cudaRuntime = readCuda();
  } catch {
    // Treated as absent, which is the safe direction: it only ever demotes.
  }

  return hardwareProfileSchema.parse({
    cpuCores,
    cpuModel,
    totalMemGb,
    gpuVendor: vendor,
    gpuName,
    cudaRuntime
  });
};
