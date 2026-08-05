import { generateKeyPairSync, createHash, sign as cryptoSign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createUpdater,
  verifyArtifact,
  type AutoUpdaterLike,
  type UpdaterDeps
} from "./updater";
import { RELEASE_MANIFEST_FILE, signedMessage } from "../shared/release-key";

/**
 * The signature gate. This is the only thing standing between "download what is
 * at this URL" and "execute it", so the tests here are mostly about what must
 * be REFUSED: a swapped artifact, a replayed older build, a forged signature.
 *
 * A real Ed25519 keypair is generated per run rather than reusing the shipped
 * one, so these never depend on the production key and a rotation cannot make
 * them silently vacuous.
 */

const ARTIFACT = Buffer.from("pretend this is an installer");
const OTHER_ARTIFACT = Buffer.from("a different installer entirely");

const keys = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyB64: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    privateKey
  };
};

const hashOf = (bytes: Buffer): string => createHash("sha512").update(bytes).digest("hex");

interface ManifestOverrides {
  readonly version?: string;
  readonly sha512?: string;
  readonly signature?: string;
  readonly file?: string;
}

/** A feed that serves one manifest, with the signature made over real bytes. */
const makeDeps = (
  options: {
    readonly artifact?: Buffer;
    readonly signedVersion?: string;
    readonly signedBytes?: Buffer;
    readonly manifest?: ManifestOverrides;
    readonly publicKeyB64?: string;
    readonly privateKey?: ReturnType<typeof keys>["privateKey"];
    readonly status?: number;
  } = {}
): UpdaterDeps & { readonly publicKeyB64: string } => {
  const pair = keys();
  const privateKey = options.privateKey ?? pair.privateKey;
  const artifact = options.artifact ?? ARTIFACT;
  const signedBytes = options.signedBytes ?? artifact;
  const version = options.signedVersion ?? "1.2.0";

  const signature = cryptoSign(
    null,
    Buffer.from(signedMessage(hashOf(signedBytes), version), "utf8"),
    privateKey
  ).toString("base64");

  const manifest = {
    version,
    file: "struq-voice-setup.exe",
    sha512: hashOf(signedBytes),
    signature,
    ...options.manifest
  };

  return {
    publicKeyB64: options.publicKeyB64 ?? pair.publicKeyB64,
    readFile: () => Promise.resolve(artifact),
    fetch: ((url: string) => {
      expect(url).toContain(RELEASE_MANIFEST_FILE);
      return Promise.resolve({
        ok: (options.status ?? 200) < 400,
        status: options.status ?? 200,
        json: () => Promise.resolve(manifest)
      });
    }) as unknown as typeof fetch
  };
};

const verify = (deps: UpdaterDeps, expectedVersion = "1.2.0") =>
  verifyArtifact(
    { feedUrl: "https://feed.test/voice", filePath: "C:\\tmp\\setup.exe", expectedVersion },
    deps
  );

describe("artifact verification", () => {
  it("accepts an artifact signed by the release key", async () => {
    const outcome = await verify(makeDeps());
    expect(outcome.ok).toBe(true);
  });

  // The artifact was swapped after signing: the bytes no longer hash to what
  // the manifest claims.
  it("refuses when the file does not match the manifest hash", async () => {
    const deps = makeDeps({ artifact: OTHER_ARTIFACT, signedBytes: ARTIFACT });
    const outcome = await verify(deps);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain("hash mismatch");
  });

  // A genuinely signed OLDER build replayed onto the feed. The bytes are
  // authentic and the signature verifies; only the version gives it away.
  it("refuses a downgrade replay", async () => {
    const deps = makeDeps({ signedVersion: "0.9.0" });
    const outcome = await verify(deps, "1.2.0");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain("version mismatch");
  });

  it("refuses a signature made with the wrong key", async () => {
    const stranger = keys();
    const deps = makeDeps({ privateKey: stranger.privateKey });
    const outcome = await verify(deps);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain("does not verify");
  });

  it("refuses a tampered signature", async () => {
    const deps = makeDeps({ manifest: { signature: Buffer.alloc(64).toString("base64") } });
    const outcome = await verify(deps);
    expect(outcome.ok).toBe(false);
  });

  it("refuses a manifest missing its signature", async () => {
    const deps = makeDeps();
    const outcome = await verifyArtifact(
      { feedUrl: "https://feed.test/voice", filePath: "x", expectedVersion: "1.2.0" },
      {
        ...deps,
        fetch: (() =>
          Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ version: "1.2.0", sha512: "abc" })
          })) as unknown as typeof fetch
      }
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain("missing");
  });

  it("refuses when the manifest cannot be fetched", async () => {
    const outcome = await verify(makeDeps({ status: 404 }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain("404");
  });

  it("refuses when the downloaded file cannot be read", async () => {
    const deps = makeDeps();
    const outcome = await verifyArtifact(
      { feedUrl: "https://feed.test/voice", filePath: "missing", expectedVersion: "1.2.0" },
      { ...deps, readFile: () => Promise.reject(new Error("ENOENT")) }
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain("could not read");
  });
});

const fakeAutoUpdater = (
  overrides: Partial<AutoUpdaterLike> = {}
): AutoUpdaterLike & { readonly installs: boolean[] } => {
  const installs: boolean[] = [];
  return {
    installs,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    setFeedURL: () => undefined,
    checkForUpdates: () => Promise.resolve({ updateInfo: { version: "1.2.0" } }),
    downloadUpdate: () => Promise.resolve(["C:\\tmp\\setup.exe"]),
    quitAndInstall: (isSilent: boolean) => {
      installs.push(isSilent);
    },
    on: () => undefined,
    ...overrides
  };
};

describe("update flow", () => {
  it("skips the check entirely in a dev build", async () => {
    const auto = fakeAutoUpdater({
      checkForUpdates: () => {
        throw new Error("should not be called");
      }
    });
    const updater = createUpdater({ autoUpdater: auto, isPackaged: false });
    const state = await updater.check();
    expect(state.phase).toBe("idle");
  });

  // autoDownload would let the library install before the gate runs, which
  // would make the whole signature check decorative.
  it("takes manual control of download and install", () => {
    const auto = fakeAutoUpdater();
    createUpdater({ autoUpdater: auto, isPackaged: true });
    expect(auto.autoDownload).toBe(false);
    expect(auto.autoInstallOnAppQuit).toBe(false);
  });

  it("reaches ready when verification passes", async () => {
    const updater = createUpdater({
      autoUpdater: fakeAutoUpdater(),
      isPackaged: true,
      verify: () => Promise.resolve({ ok: true })
    });
    const state = await updater.check();
    expect(state).toEqual({ phase: "ready", version: "1.2.0" });
  });

  it("refuses rather than installing when verification fails", async () => {
    const auto = fakeAutoUpdater();
    const updater = createUpdater({
      autoUpdater: auto,
      isPackaged: true,
      verify: () => Promise.resolve({ ok: false, reason: "signature does not verify" })
    });
    const state = await updater.check();
    expect(state.phase).toBe("refused");
    // The refusal is only real if nothing installed.
    expect(updater.install()).toBe(false);
    expect(auto.installs).toEqual([]);
  });

  it("stays idle when the feed offers nothing", async () => {
    const updater = createUpdater({
      autoUpdater: fakeAutoUpdater({ checkForUpdates: () => Promise.resolve(null) }),
      isPackaged: true
    });
    expect((await updater.check()).phase).toBe("idle");
  });

  it("reports an unreachable feed as idle rather than an error", async () => {
    const updater = createUpdater({
      autoUpdater: fakeAutoUpdater({
        checkForUpdates: () => Promise.reject(new Error("ENOTFOUND"))
      }),
      isPackaged: true
    });
    const state = await updater.check();
    expect(state.phase).toBe("idle");
  });

  it("installs silently and forces the relaunch once ready", async () => {
    const auto = fakeAutoUpdater();
    const updater = createUpdater({
      autoUpdater: auto,
      isPackaged: true,
      verify: () => Promise.resolve({ ok: true })
    });
    await updater.check();
    expect(updater.install()).toBe(true);
    expect(auto.installs).toEqual([true]);
  });

  it("does nothing when install is called before an update is ready", () => {
    const auto = fakeAutoUpdater();
    const updater = createUpdater({ autoUpdater: auto, isPackaged: true });
    expect(updater.install()).toBe(false);
    expect(auto.installs).toEqual([]);
  });

  it("notifies subscribers as the state moves", async () => {
    const seen: string[] = [];
    const updater = createUpdater({
      autoUpdater: fakeAutoUpdater(),
      isPackaged: true,
      verify: () => Promise.resolve({ ok: true })
    });
    updater.subscribe((state) => seen.push(state.phase));
    await updater.check();
    expect(seen).toEqual(["checking", "downloading", "ready"]);
  });

  it("stops notifying after unsubscribe", async () => {
    const listener = vi.fn();
    const updater = createUpdater({
      autoUpdater: fakeAutoUpdater(),
      isPackaged: true,
      verify: () => Promise.resolve({ ok: true })
    });
    updater.subscribe(listener)();
    await updater.check();
    expect(listener).not.toHaveBeenCalled();
  });

  // A second check would overwrite the version being verified, which is exactly
  // what the signature is meant to pin down.
  it("ignores a second check while one is in flight", async () => {
    let calls = 0;
    const updater = createUpdater({
      autoUpdater: fakeAutoUpdater({
        checkForUpdates: async () => {
          calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { updateInfo: { version: "1.2.0" } };
        }
      }),
      isPackaged: true,
      verify: () => Promise.resolve({ ok: true })
    });
    const [first] = await Promise.all([updater.check(), updater.check()]);
    expect(calls).toBe(1);
    expect(first.phase).toBe("ready");
  });
});

describe("install timing", () => {
  const readyUpdater = (
    auto: AutoUpdaterLike,
    isBusy: () => boolean
  ): ReturnType<typeof createUpdater> =>
    createUpdater({
      autoUpdater: auto,
      isPackaged: true,
      verify: () => Promise.resolve({ ok: true }),
      isBusy
    });

  // Quitting mid-capture discards audio the user has already spoken. The click
  // is accepted, the restart is not immediate.
  it("holds the install while a capture is in flight", async () => {
    const auto = fakeAutoUpdater();
    const updater = readyUpdater(auto, () => true);
    await updater.check();

    expect(updater.install()).toBe(true);
    expect(auto.installs).toEqual([]);
  });

  it("runs the held install once the capture ends", async () => {
    const auto = fakeAutoUpdater();
    let busy = true;
    const updater = readyUpdater(auto, () => busy);
    await updater.check();
    updater.install();

    busy = false;
    updater.notifyIdle();
    expect(auto.installs).toEqual([true]);
  });

  it("installs immediately when nothing is in flight", async () => {
    const auto = fakeAutoUpdater();
    const updater = readyUpdater(auto, () => false);
    await updater.check();

    expect(updater.install()).toBe(true);
    expect(auto.installs).toEqual([true]);
  });

  // notifyIdle fires on every capture. Without a prior click it must do
  // nothing, or the app would restart itself the moment an update was ready.
  it("never installs on idle without a click", async () => {
    const auto = fakeAutoUpdater();
    const updater = readyUpdater(auto, () => false);
    await updater.check();

    updater.notifyIdle();
    updater.notifyIdle();
    expect(auto.installs).toEqual([]);
  });

  it("runs a held install only once", async () => {
    const auto = fakeAutoUpdater();
    let busy = true;
    const updater = readyUpdater(auto, () => busy);
    await updater.check();
    updater.install();

    busy = false;
    updater.notifyIdle();
    updater.notifyIdle();
    expect(auto.installs).toEqual([true]);
  });

  it("announces a ready update once, not on every check", async () => {
    const ready = vi.fn();
    const updater = createUpdater({
      autoUpdater: fakeAutoUpdater(),
      isPackaged: true,
      verify: () => Promise.resolve({ ok: true }),
      onReady: ready
    });

    await updater.check();
    await updater.check();
    expect(ready).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledWith("1.2.0");
  });

  it("does not announce an update that was refused", async () => {
    const ready = vi.fn();
    const updater = createUpdater({
      autoUpdater: fakeAutoUpdater(),
      isPackaged: true,
      verify: () => Promise.resolve({ ok: false, reason: "signature does not verify" }),
      onReady: ready
    });

    await updater.check();
    expect(ready).not.toHaveBeenCalled();
  });
});
