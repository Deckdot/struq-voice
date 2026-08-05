/**
 * Machine profiling and the model recommendation derived from it. Pure and
 * Electron-free so main, renderer and tests can all import it: the probing
 * itself lives in src/main/hardware/detect.ts, which is the only part that
 * needs Electron.
 *
 * The recommendation exists so a fresh install never asks the user to choose
 * between 31 catalog entries. It picks one, names the hardware it saw, and
 * lets the user override.
 */

import { z } from "zod";
import { DEFAULT_WHISPER_MODEL_ID } from "./models";

export const gpuVendorSchema = z.enum(["nvidia", "amd", "intel", "apple", "unknown"]);

export type GpuVendor = z.infer<typeof gpuVendorSchema>;

export const hardwareProfileSchema = z.object({
  /** Logical cores as reported by os.cpus(). */
  cpuCores: z.number().int().min(1).default(1),
  cpuModel: z.string().default("Unknown CPU"),
  /** Physical memory, rounded to whole GB. */
  totalMemGb: z.number().min(0).default(0),
  gpuVendor: gpuVendorSchema.default("unknown"),
  gpuName: z.string().nullable().default(null),
  /** The whisper.cpp CUDA runtime is present next to whisper-cli.exe. */
  cudaRuntime: z.boolean().default(false)
});

export type HardwareProfile = z.infer<typeof hardwareProfileSchema>;

/**
 * What a machine can comfortably run. Deliberately three buckets: the only
 * decision downstream is which model to hand someone, and a finer grain would
 * imply a precision this detection does not have.
 */
export type MachineTier = "light" | "balanced" | "performance";

export interface ModelRecommendation {
  /** Catalog id, always present in MODEL_CATALOG. */
  readonly modelId: string;
  /** Engine that loads it: the settings value written on accept. */
  readonly engineId: "parakeet" | "whisper-cpp";
  readonly tier: MachineTier;
  /**
   * User-facing sentence naming the hardware that produced this choice, so
   * the recommendation reads as observed rather than guessed.
   */
  readonly reason: string;
}

/** The profile used when detection fails outright. Classifies as balanced. */
export const UNKNOWN_HARDWARE: HardwareProfile = hardwareProfileSchema.parse({
  cpuCores: 8,
  cpuModel: "Unknown CPU",
  totalMemGb: 16,
  gpuVendor: "unknown",
  gpuName: null,
  cudaRuntime: false
});

const PARAKEET_V3_ID = "parakeet-tdt-0.6b-v3-int8";

/**
 * Memory thresholds sit below the nominal sizes they stand for. Windows
 * reports installed RAM minus what the hardware reserves, so a 32GB machine
 * measures about 31.2GB and a 16GB one about 15.8GB. Testing against the
 * advertised number would miss every real machine.
 */
const PERFORMANCE_MEM_GB = 30;
const BALANCED_MEM_GB = 15;

/**
 * A discrete NVIDIA card with the CUDA runtime already present is the one
 * signal that genuinely changes what this machine can do, so it promotes on
 * its own. Everything else is decided by cores and memory together: eight
 * cores paired with 8GB is not a balanced machine, and the `and` matters.
 */
export function classifyMachine(profile: HardwareProfile): MachineTier {
  if (profile.gpuVendor === "nvidia" && profile.cudaRuntime) return "performance";
  if (profile.cpuCores >= 12 && profile.totalMemGb >= PERFORMANCE_MEM_GB) return "performance";
  if (profile.cpuCores >= 8 && profile.totalMemGb >= BALANCED_MEM_GB) return "balanced";
  return "light";
}

const formatMemory = (gb: number): string =>
  gb > 0 ? `${String(Math.round(gb))} GB RAM` : "unknown memory";

const formatCores = (cores: number): string =>
  `${String(cores)} ${cores === 1 ? "core" : "cores"}`;

/**
 * The hardware sentence. Names the GPU when there is one worth naming,
 * because that is the part a user recognises, then the cores and memory that
 * actually carried the decision.
 */
export function describeHardware(profile: HardwareProfile): string {
  const parts: string[] = [];
  if (profile.gpuName !== null && profile.gpuVendor !== "unknown") {
    parts.push(profile.gpuName);
  }
  parts.push(formatCores(profile.cpuCores));
  parts.push(formatMemory(profile.totalMemGb));
  return parts.join(", ");
}

/**
 * One model per machine. Parakeet int8 is the catalog default and stays the
 * answer wherever it fits: it is multilingual and CPU-friendly. A light
 * machine gets whisper base q5_1 instead, which is 60MB against Parakeet's
 * 670MB and runs anywhere.
 */
export function recommendModel(profile: HardwareProfile): ModelRecommendation {
  const tier = classifyMachine(profile);
  const hardware = describeHardware(profile);

  if (tier === "light") {
    return {
      modelId: DEFAULT_WHISPER_MODEL_ID,
      engineId: "whisper-cpp",
      tier,
      reason: `${hardware}. A compact model keeps transcription quick on this machine.`
    };
  }

  return {
    modelId: PARAKEET_V3_ID,
    engineId: "parakeet",
    tier,
    reason:
      tier === "performance"
        ? `${hardware}. This machine can run the most accurate local model comfortably.`
        : `${hardware}. Enough headroom for the best all-round local model.`
  };
}
