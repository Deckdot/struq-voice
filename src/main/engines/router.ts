/**
 * The engine router: primary plus optional fallback. Cascades on not-ready,
 * error, or timeout, and reports which engine actually produced the text.
 * Never cascades from a local engine to a cloud one without explicit opt-in,
 * because that would send audio off the machine without the user choosing to.
 */

import type { Result } from "../../shared/result";
import { fail } from "../../shared/result";
import type {
  TranscribeRequest,
  TranscribeResult,
  TranscriptionEngine
} from "./types";

export interface RouterOutcome {
  readonly result: TranscribeResult;
  readonly fallbackUsed: boolean;
}

export interface EngineRouterInput {
  readonly getEngine: (id: string) => TranscriptionEngine | undefined;
  /** Local to cloud cascade requires explicit opt-in. */
  readonly cloudFallbackOptIn: () => boolean;
  /** Test seams; production uses the plan's budgets. */
  readonly localTimeoutMs?: number;
  readonly cloudTimeoutMs?: number;
}

export interface EngineRouter {
  transcribe: (
    request: Omit<TranscribeRequest, "signal">,
    primaryId: string,
    fallbackId: string | null
  ) => Promise<Result<RouterOutcome>>;
}

const CLOUD_TIMEOUT_MS = 60_000;
const LOCAL_TIMEOUT_MS = 20_000;

export const createEngineRouter = (input: EngineRouterInput): EngineRouter => {
  const run = async (
    request: Omit<TranscribeRequest, "signal">,
    engine: TranscriptionEngine
  ): Promise<Result<TranscribeResult>> => {
    const readiness = await engine.readiness();
    if (!readiness.ready) {
      return fail({
        code: "APP_NOT_READY",
        message: readiness.reason ?? "Engine is not ready."
      });
    }
    const controller = new AbortController();
    const timeoutMs =
      engine.kind === "cloud"
        ? (input.cloudTimeoutMs ?? CLOUD_TIMEOUT_MS)
        : (input.localTimeoutMs ?? LOCAL_TIMEOUT_MS);
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      return await engine.transcribe({ ...request, signal: controller.signal });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return fail({ code: "UNKNOWN", message: `Engine "${engine.id}" failed: ${message}` });
    } finally {
      clearTimeout(timer);
    }
  };

  const canCascade = (
    primary: TranscriptionEngine,
    fallback: TranscriptionEngine
  ): boolean => {
    if (primary.kind === "cloud") return true;
    if (fallback.kind === "local") return true;
    return input.cloudFallbackOptIn();
  };

  return {
    transcribe: async (
      request,
      primaryId,
      fallbackId
    ): Promise<Result<RouterOutcome>> => {
      const primary = input.getEngine(primaryId);
      if (primary === undefined) {
        return fail({
          code: "UNKNOWN",
          message: `Engine "${primaryId}" is not installed. Pick another engine in Settings.`
        });
      }

      const primaryResult = await run(request, primary);
      if (primaryResult.ok) {
        return {
          ok: true,
          value: { result: primaryResult.value, fallbackUsed: false }
        };
      }

      const fallback =
        fallbackId !== null ? input.getEngine(fallbackId) : undefined;
      if (fallback === undefined || !canCascade(primary, fallback)) {
        return primaryResult;
      }

      const fallbackResult = await run(request, fallback);
      if (fallbackResult.ok) {
        return {
          ok: true,
          value: { result: fallbackResult.value, fallbackUsed: true }
        };
      }
      // Report the primary's error: it names the cause the user can fix.
      return primaryResult;
    }
  };
};
