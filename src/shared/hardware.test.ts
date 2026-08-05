import { describe, expect, it } from "vitest";
import {
  UNKNOWN_HARDWARE,
  classifyMachine,
  describeHardware,
  hardwareProfileSchema,
  recommendModel
} from "./hardware";
import type { HardwareProfile } from "./hardware";
import { DEFAULT_WHISPER_MODEL_ID, findModel } from "./models";

/**
 * The recommendation decides what a fresh install downloads without asking,
 * so these tests pin the boundaries rather than the prose: an off-by-one in
 * the tier thresholds hands a 670MB model to a machine that cannot run it.
 */

const machine = (patch: Partial<HardwareProfile>): HardwareProfile =>
  hardwareProfileSchema.parse({ ...UNKNOWN_HARDWARE, ...patch });

describe("classifyMachine", () => {
  it("promotes an NVIDIA card with the CUDA runtime present", () => {
    const profile = machine({
      cpuCores: 4,
      totalMemGb: 8,
      gpuVendor: "nvidia",
      gpuName: "NVIDIA GeForce RTX 4070",
      cudaRuntime: true
    });
    expect(classifyMachine(profile)).toBe("performance");
  });

  // The card alone is not enough: without the runtime, whisper falls back to
  // CPU and the machine performs like its cores say it does.
  it("does not promote an NVIDIA card without the CUDA runtime", () => {
    const profile = machine({
      cpuCores: 4,
      totalMemGb: 8,
      gpuVendor: "nvidia",
      gpuName: "NVIDIA GeForce GTX 1050",
      cudaRuntime: false
    });
    expect(classifyMachine(profile)).toBe("light");
  });

  it("promotes a high core count paired with plenty of memory", () => {
    expect(classifyMachine(machine({ cpuCores: 12, totalMemGb: 32 }))).toBe("performance");
  });

  it("classifies the common desktop as balanced", () => {
    expect(classifyMachine(machine({ cpuCores: 8, totalMemGb: 16 }))).toBe("balanced");
  });

  // Windows reports installed RAM minus what the hardware reserves, so a
  // nominal 32GB machine measures ~31.2GB and a 16GB one ~15.8GB. Thresholds
  // written against the advertised size miss every real machine, which is
  // exactly what happened on the first pass here.
  it("classifies machines by their reported memory, not their advertised size", () => {
    expect(
      classifyMachine(
        machine({ cpuCores: 16, totalMemGb: 31, cpuModel: "AMD Ryzen 7 7800X3D 8-Core Processor" })
      )
    ).toBe("performance");
    expect(classifyMachine(machine({ cpuCores: 8, totalMemGb: 15 }))).toBe("balanced");
  });

  // Cores and memory are an `and`, not an `or`. Eight cores with 8GB is not a
  // balanced machine, and treating it as one hands it a model it will swap on.
  it("requires both cores and memory to clear a tier", () => {
    expect(classifyMachine(machine({ cpuCores: 16, totalMemGb: 8 }))).toBe("light");
    expect(classifyMachine(machine({ cpuCores: 4, totalMemGb: 64 }))).toBe("light");
    expect(classifyMachine(machine({ cpuCores: 12, totalMemGb: 16 }))).toBe("balanced");
  });

  it("classifies a small machine as light", () => {
    expect(classifyMachine(machine({ cpuCores: 2, totalMemGb: 4 }))).toBe("light");
  });
});

describe("recommendModel", () => {
  it("recommends a model that exists in the catalog", () => {
    const profiles = [
      machine({ cpuCores: 2, totalMemGb: 4 }),
      machine({ cpuCores: 8, totalMemGb: 16 }),
      machine({ cpuCores: 16, totalMemGb: 64 })
    ];
    for (const profile of profiles) {
      const recommendation = recommendModel(profile);
      const model = findModel(recommendation.modelId);
      expect(model).not.toBeNull();
      expect(model?.engine).toBe(recommendation.engineId);
    }
  });

  it("hands a light machine the small whisper build", () => {
    const recommendation = recommendModel(machine({ cpuCores: 2, totalMemGb: 4 }));
    expect(recommendation.modelId).toBe(DEFAULT_WHISPER_MODEL_ID);
    expect(recommendation.engineId).toBe("whisper-cpp");
    expect(findModel(recommendation.modelId)?.bytes ?? Infinity).toBeLessThan(200_000_000);
  });

  it("hands a capable machine parakeet", () => {
    const recommendation = recommendModel(machine({ cpuCores: 16, totalMemGb: 32 }));
    expect(recommendation.engineId).toBe("parakeet");
    expect(recommendation.tier).toBe("performance");
  });

  // The reason is shown verbatim in onboarding. It has to name what was seen,
  // or the recommendation reads as a guess.
  it("names the detected hardware in the reason", () => {
    const recommendation = recommendModel(
      machine({
        cpuCores: 16,
        totalMemGb: 32,
        gpuVendor: "nvidia",
        gpuName: "NVIDIA GeForce RTX 4070",
        cudaRuntime: true
      })
    );
    expect(recommendation.reason).toContain("NVIDIA GeForce RTX 4070");
    expect(recommendation.reason).toContain("16 cores");
    expect(recommendation.reason).toContain("32 GB RAM");
  });

  it("never recommends the mock engine", () => {
    expect(recommendModel(UNKNOWN_HARDWARE).engineId).not.toBe("mock");
  });

  // Detection failure must still produce a usable app rather than no choice.
  it("falls back to a working recommendation on the unknown profile", () => {
    const recommendation = recommendModel(UNKNOWN_HARDWARE);
    expect(recommendation.tier).toBe("balanced");
    expect(findModel(recommendation.modelId)).not.toBeNull();
  });
});

describe("describeHardware", () => {
  it("omits the GPU when none was identified", () => {
    const described = describeHardware(machine({ cpuCores: 8, totalMemGb: 16 }));
    expect(described).toBe("8 cores, 16 GB RAM");
  });

  it("singularises a single core", () => {
    expect(describeHardware(machine({ cpuCores: 1 }))).toContain("1 core,");
  });
});

describe("hardwareProfileSchema", () => {
  it("fills every field from an empty object", () => {
    const parsed = hardwareProfileSchema.parse({});
    expect(parsed.cpuCores).toBe(1);
    expect(parsed.gpuVendor).toBe("unknown");
    expect(parsed.gpuName).toBeNull();
    expect(parsed.cudaRuntime).toBe(false);
  });

  it("rejects an unknown gpu vendor", () => {
    expect(hardwareProfileSchema.safeParse({ gpuVendor: "matrox" }).success).toBe(false);
  });
});
