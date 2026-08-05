/**
 * The update channel, and the signature gate that makes it safe to have.
 *
 * Struq Voice ships without a code signing certificate. That is fine while the
 * only way onto a machine is running an installer you were handed: there is no
 * remote path in, so there is nothing for a certificate to defend. An update
 * channel creates that path. It is, precisely, "download what is at this URL
 * and execute it".
 *
 * On Windows electron-updater authenticates an update by comparing the
 * installed binary's publisherName against the update certificate's Common
 * Name. With no certificate there is nothing to compare, and there is a known
 * bypass of that check even when there is (CVE-2024-39698). The library's own
 * verification is therefore not load-bearing here. THIS module is.
 *
 * Every downloaded artifact is checked against `src/shared/release-key.ts`
 * before it is allowed to install, and a failed check aborts. Not warns, not
 * prompts: a prompt people click through is the same as no check, one step
 * removed.
 *
 * Everything electron-specific is injected, so the gate is unit testable
 * without a packaged app or a network, matching the pattern in engines and
 * paste.
 */

import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  RELEASE_MANIFEST_FILE,
  RELEASE_PUBLIC_KEY_B64,
  signedMessage,
  type ReleaseManifest
} from "../shared/release-key";
import { INITIAL_UPDATE_STATE, type UpdateState } from "../shared/updates";

/** Where installed copies look for updates. Overridable for a self-hosted feed. */
export const DEFAULT_FEED_URL =
  process.env["STRUQ_VOICE_FEED_URL"] ?? "https://updates.struq.app/voice";

export interface UpdaterDeps {
  /** Fetch the manifest that rides beside the installer. */
  readonly fetch?: typeof fetch;
  /** Read the downloaded artifact, so the hash is computed over real bytes. */
  readonly readFile?: (path: string) => Promise<Buffer>;
  readonly publicKeyB64?: string;
}

export interface VerifyInput {
  readonly feedUrl: string;
  readonly filePath: string;
  /** The version the feed announced, bound into the signature check. */
  readonly expectedVersion: string;
}

export type VerifyOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Verify a downloaded artifact against the embedded public key.
 *
 * Three checks, all of which must pass. They fail differently and the
 * difference is worth reporting: a bad hash is a corrupted or swapped file, a
 * version mismatch is a replay of an older signed build, a bad signature is a
 * forgery or the wrong key.
 */
export const verifyArtifact = async (
  input: VerifyInput,
  deps: UpdaterDeps = {}
): Promise<VerifyOutcome> => {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const readFileImpl = deps.readFile ?? ((path: string) => readFile(path));
  const keyB64 = deps.publicKeyB64 ?? RELEASE_PUBLIC_KEY_B64;

  let manifest: Partial<ReleaseManifest>;
  try {
    const response = await fetchImpl(`${input.feedUrl}/${RELEASE_MANIFEST_FILE}`, {
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) {
      return { ok: false, reason: `manifest fetch returned ${String(response.status)}` };
    }
    manifest = (await response.json()) as Partial<ReleaseManifest>;
  } catch (error) {
    return { ok: false, reason: `manifest unreachable: ${String(error)}` };
  }

  if (
    manifest.sha512 === undefined ||
    manifest.signature === undefined ||
    manifest.version === undefined
  ) {
    return { ok: false, reason: "manifest is missing sha512, signature or version" };
  }

  // Recomputed from the bytes on disk. Trusting the manifest's own claim about
  // its hash would verify nothing: an attacker who can change the artifact can
  // change the number beside it. Only the signature is hard to forge, so the
  // hash has to be derived here and then checked through the signed message.
  let actualSha512: string;
  try {
    actualSha512 = createHash("sha512").update(await readFileImpl(input.filePath)).digest("hex");
  } catch (error) {
    return { ok: false, reason: `could not read the downloaded file: ${String(error)}` };
  }

  if (actualSha512 !== manifest.sha512) {
    return {
      ok: false,
      reason: `hash mismatch: file is ${actualSha512.slice(0, 16)}..., manifest claims ${manifest.sha512.slice(0, 16)}...`
    };
  }

  // The version is bound into the signed message, so this is what refuses a
  // downgrade: a replayed older build presents authentic bytes and a real
  // signature, and only the version gives it away.
  if (manifest.version !== input.expectedVersion) {
    return {
      ok: false,
      reason: `version mismatch: manifest says ${manifest.version}, update claims ${input.expectedVersion}`
    };
  }

  let valid: boolean;
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(keyB64, "base64"),
      format: "der",
      type: "spki"
    });
    valid = verifySignature(
      null,
      Buffer.from(signedMessage(actualSha512, manifest.version), "utf8"),
      publicKey,
      Buffer.from(manifest.signature, "base64")
    );
  } catch (error) {
    return { ok: false, reason: `signature check could not run: ${String(error)}` };
  }

  if (!valid) return { ok: false, reason: "signature does not verify under the release key" };
  return { ok: true };
};

/** The slice of electron-updater this module drives, so tests can fake it. */
export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  setFeedURL: (options: { provider: "generic"; url: string }) => void;
  checkForUpdates: () => Promise<{ updateInfo?: { version?: string } } | null>;
  downloadUpdate: () => Promise<string[] | string>;
  quitAndInstall: (isSilent: boolean, isForceRunAfter: boolean) => void;
  /** Overloaded per event, so each listener gets the payload it actually receives. */
  on: {
    (event: "update-available", listener: (info: { version?: string }) => void): unknown;
    (event: "download-progress", listener: (progress: { percent?: number }) => void): unknown;
    (event: "error", listener: (error: Error) => void): unknown;
  };
}

export interface UpdaterController {
  getState: () => UpdateState;
  subscribe: (listener: (state: UpdateState) => void) => () => void;
  check: () => Promise<UpdateState>;
  install: () => boolean;
}

export interface UpdaterOptions {
  readonly autoUpdater: AutoUpdaterLike;
  /** False in dev, where there is nothing to update. */
  readonly isPackaged: boolean;
  readonly feedUrl?: string;
  readonly deps?: UpdaterDeps;
  readonly verify?: (input: VerifyInput, deps?: UpdaterDeps) => Promise<VerifyOutcome>;
}

export const createUpdater = (options: UpdaterOptions): UpdaterController => {
  const feedUrl = options.feedUrl ?? DEFAULT_FEED_URL;
  const verify = options.verify ?? verifyArtifact;
  const listeners = new Set<(state: UpdateState) => void>();
  let state: UpdateState = INITIAL_UPDATE_STATE;
  let announcedVersion: string | null = null;
  let checking = false;

  const setState = (next: UpdateState): void => {
    state = next;
    for (const listener of listeners) listener(next);
  };

  // Drive the sequence by hand so verification sits BETWEEN download and
  // install. With autoDownload on, the library can install before the gate runs.
  options.autoUpdater.autoDownload = false;
  options.autoUpdater.autoInstallOnAppQuit = false;
  options.autoUpdater.on("update-available", (info: { version?: string }) => {
    announcedVersion = info.version ?? null;
  });
  options.autoUpdater.on("download-progress", (progress: { percent?: number }) => {
    setState({ phase: "downloading", percent: progress.percent ?? 0 });
  });
  options.autoUpdater.on("error", (error: Error) => {
    setState({ phase: "error", message: `updater error: ${String(error)}` });
  });

  const check = async (): Promise<UpdateState> => {
    if (!options.isPackaged) {
      setState({ phase: "idle", note: "Dev build, update check skipped" });
      return state;
    }
    // A second check while one is running would overwrite the version being
    // verified, which is exactly what the signature is meant to pin down.
    if (checking) return state;

    checking = true;
    setState({ phase: "checking" });
    try {
      options.autoUpdater.setFeedURL({ provider: "generic", url: feedUrl });
      announcedVersion = null;

      // checkForUpdates resolves with the info, and the update-available event
      // also carries it. Either is fine; no version at all means no update.
      const result = await options.autoUpdater.checkForUpdates();
      const version = result?.updateInfo?.version ?? announcedVersion;
      if (version === null) {
        setState({ phase: "idle" });
        return state;
      }

      setState({ phase: "downloading", percent: 0 });
      const downloaded = await options.autoUpdater.downloadUpdate();
      const filePath = Array.isArray(downloaded) ? (downloaded[0] ?? "") : downloaded;

      const outcome = await verify(
        { feedUrl, filePath, expectedVersion: version },
        options.deps
      );
      if (!outcome.ok) {
        // The refusal IS the feature. Nothing installs, and the state is
        // visible rather than a log line nobody reads.
        setState({ phase: "refused", reason: outcome.reason });
        return state;
      }

      setState({ phase: "ready", version });
      return state;
    } catch (error) {
      // An unreachable feed is not something to shout about: the app works
      // fine without an update. A refused one is the opposite, handled above.
      setState({ phase: "idle", note: `Could not check for updates: ${String(error)}` });
      return state;
    } finally {
      checking = false;
    }
  };

  /**
   * Install and restart, only when a person asks.
   *
   * No auto-restart, deliberately. Dictation runs while other work is in
   * progress, and an app that restarts itself mid-sentence is worse than one
   * running last week's build for another hour.
   *
   * isSilent passes /S so the installer runs with no UI for an update the
   * person already agreed to, and isForceRunAfter passes --force-run, which
   * relaunches afterwards. Both are load-bearing: silent without force-run
   * installs correctly and never comes back, which looks exactly like a crash.
   */
  const install = (): boolean => {
    if (state.phase !== "ready") return false;
    options.autoUpdater.quitAndInstall(true, true);
    return true;
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    check,
    install
  };
};
