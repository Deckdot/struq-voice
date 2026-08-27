/**
 * Result type, ported from StruqADE packages/ipc/src/index.ts.
 * The renderer never catches exceptions across IPC; it matches on Result.
 */

export interface VoiceError {
  readonly code: VoiceErrorCode;
  readonly message: string;
}

/**
 * TIMEOUT is separate from UNKNOWN because it is the one failure the user can
 * act on without knowing anything about engines: the decode ran out of budget
 * rather than breaking.
 */
export type VoiceErrorCode =
  | "UNKNOWN"
  | "INVALID_REQUEST"
  | "APP_NOT_READY"
  | "TIMEOUT";

export type Result<TValue> =
  | {
      readonly ok: true;
      readonly value: TValue;
    }
  | {
      readonly ok: false;
      readonly error: VoiceError;
    };

export const ok = <TValue>(value: TValue): Result<TValue> => ({
  ok: true,
  value,
});

export const fail = (error: VoiceError): Result<never> => ({
  ok: false,
  error,
});
