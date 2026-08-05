/**
 * Engine ids shared by main and renderer. The full catalog with download URLs
 * lives in src/shared/models.ts (Phase 5); this holds the ids every surface
 * needs today.
 */

export const MOCK_ENGINE_ID = "mock" as const;

export interface EngineDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly kind: "local" | "cloud" | "test";
}

export const MOCK_ENGINE: EngineDescriptor = {
  id: MOCK_ENGINE_ID,
  displayName: "Mock",
  kind: "test"
};
