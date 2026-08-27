/**
 * The engine router: primary plus optional fallback. Cascades on not-ready,
 * error, or timeout, and reports which engine actually produced the text.
 * Never cascades from a local engine to a cloud one without explicit opt-in,
 * because that would send audio off the machine without the user choosing to.
 */

import type { Result } from "../../shared/result";
import { fail } from "../../shared/result";
import { transcribeTimeoutMs } from "./timeouts";
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
  /**
   * Fixed budgets, for tests only. Production derives the budget from the
   * length of the audio (see `transcribeTimeoutMs`), because a fixed number
   * is either too tight for a long recording or useless for a short one.
   */
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

/**
 * A budget that ran out says something quite different from an engine that
 * broke, and the difference is what the user can act on: a slower model, a
 * shorter take, or a machine that was busy.
 */
const timeoutError = (
  engine: TranscriptionEngine,
  timeoutMs: number
): { code: "TIMEOUT"; message: string } => ({
  code: "TIMEOUT",
  message: `${engine.displayName} did not finish within ${String(
    Math.round(timeoutMs / 1000)
  )} seconds. Try a smaller model, or record a shorter take.`
});

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
    const override =
      engine.kind === "cloud" ? input.cloudTimeoutMs : input.localTimeoutMs;
    const timeoutMs =
      override ?? transcribeTimeoutMs(engine.kind, request.durationMs);
    // A plain `let` here reads as permanently false to the type checker: the
    // only write happens inside a callback it cannot see running.
    const budget = { spent: false };
    const timer = setTimeout(() => {
      budget.spent = true;
      controller.abort();
    }, timeoutMs);
    try {
      const outcome = await engine.transcribe({
        ...request,
        signal: controller.signal
      });
      // An engine that folds the abort into a Result rather than throwing
      // would otherwise report it as its own failure ("cancelled"), which
      // reads as something the user did.
      if (!outcome.ok && budget.spent) return fail(timeoutError(engine, timeoutMs));
      return outcome;
    } catch (error) {
      if (budget.spent) return fail(timeoutError(engine, timeoutMs));
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
