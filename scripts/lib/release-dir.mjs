/**
 * Where a release is built, signed, verified and published from.
 *
 * ONE PLACE, because four scripts have to agree on this path. A signer reading
 * one directory and a publisher reading another ends with the wrong installer
 * on the feed, and nothing downstream would catch it: every gate would pass,
 * against the wrong file.
 *
 * WHY NOT `release/` inside the repo. electron-builder stages the unpacked app
 * as `<out>/win-unpacked.tmp` and then renames it into place. Under
 * `Documents` on Windows that rename can fail with EPERM, because something
 * holds a handle on a directory of freshly extracted .exe and .dll files, with
 * Defender real-time protection the usual suspect. Defaulting to a temp
 * directory makes the working path the one you get without typing anything.
 *
 * `STRUQ_VOICE_RELEASE_DIR` overrides it, which is what CI would set.
 */
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** The build output directory, absolute. */
export function releaseDir() {
  const override = process.env.STRUQ_VOICE_RELEASE_DIR;
  if (override) return resolve(override);
  return join(tmpdir(), "struq-voice-release");
}

/**
 * Read a `--dir` flag, falling back to the shared default. The flag stays
 * supported because signing a directory somebody handed you is a real thing to
 * want; it simply is no longer the only way to get a working build.
 */
export function releaseDirFrom(argv) {
  const index = argv.indexOf("--dir");
  if (index !== -1 && argv[index + 1]) return resolve(argv[index + 1]);
  return releaseDir();
}

/** The manifest name, restated here so the scripts share no app code. */
export const MANIFEST_FILE = "struq-voice-release.json";
