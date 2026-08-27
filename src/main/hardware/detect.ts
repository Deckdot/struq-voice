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
import { UNKNOWN_HARDWARE, hardwareProfileSchema, normalizeMemGb } from "../../shared/hardware";
import { hasCudaRuntime } from "../models/whisper-runtime-files";

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

const cleanGpuName = (raw: string | null): string | null => {
  if (raw === null) return null;
  let s = raw.trim();
  const angleMatch = s.match(/ANGLE\s*\([^,]+,\s*([^,]+)/i);
  if (angleMatch !== null && angleMatch[1] !== undefined) {
    s = angleMatch[1].trim();
  }
  s = s.replace(/\s+(Direct3D\d*|D3D\d*|OpenGL|vs_\d|ps_\d).*$/i, "").trim();
  return s.length > 0 ? s : null;
};

/**
 * The device description lives in auxAttributes under a key that has moved
 * between Chromium versions, or directly in gpuDevice.deviceString.
 */
const readGpuName = (
  aux: Record<string, unknown> | undefined,
  devices: readonly { readonly active?: boolean; readonly deviceString?: string }[] = []
): string | null => {
  const activeDevice = devices.find((candidate) => candidate.active === true) ?? devices[0];
  if (typeof activeDevice?.deviceString === "string" && activeDevice.deviceString.trim() !== "") {
    return cleanGpuName(activeDevice.deviceString);
  }
  if (aux !== undefined) {
    for (const key of ["glRenderer", "gpuDeviceDescription", "glVendor"]) {
      const value = aux[key];
      if (typeof value === "string" && value.trim() !== "") {
        return cleanGpuName(value);
      }
    }
  }
  return null;
};

const parseGpu = (info: unknown): { vendor: GpuVendor; name: string | null } => {
  if (typeof info !== "object" || info === null) return { vendor: "unknown", name: null };
  const basic = info as BasicGpuInfo;
  const devices = basic.gpuDevice ?? [];

  const name = readGpuName(basic.auxAttributes, devices);

  // Prefer the active device: laptops report both the integrated and the
  // discrete card, and the integrated one is usually listed first.
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
    totalMemGb = normalizeMemGb(readMem() / BYTES_PER_GB);
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
