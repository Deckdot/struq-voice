#!/usr/bin/env node
/**
 * sign-release: sign a built installer so installed copies will accept it.
 *
 * Struq Voice ships without a code signing certificate. That is fine while the
 * only way onto a machine is running an installer you were handed. An update
 * channel replaces that with "download what is at this URL and execute it". On
 * Windows electron-updater authenticates an update by comparing the installed
 * binary's publisherName against the update certificate's Common Name, so with
 * no certificate there is nothing to compare, and there is a known bypass of
 * that check even when there is (CVE-2024-39698). An unsigned app pulling from
 * a static path installs whatever the feed hands it.
 *
 * So the artifact carries an Ed25519 signature, verified in the app against the
 * public half in `src/shared/release-key.ts`. The private half lives only at
 * ~/.struq/struq-voice-release-private.pem and never in this repository.
 *
 * WHAT IS SIGNED, and why it is not just the hash:
 *
 *     <sha512-hex>|<version>
 *
 * A signature over the hash alone would let an attacker re-serve a GENUINELY
 * signed older build with a known bug in it. The bytes are authentic, the
 * signature verifies, and the app downgrades itself into the hole. Binding the
 * version into the signed message is what makes that fail.
 *
 * This script shares NO code with verify-release.mjs, deliberately. A verifier
 * that imports the signer's own helper proves the helper agrees with itself; if
 * both are wrong in the same way the check still passes. The message shape is
 * therefore restated in both.
 *
 * Run: node scripts/sign-release.mjs [--dir <path>] [--key <path>]
 */
import { createHash, createPrivateKey, sign as cryptoSign } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { MANIFEST_FILE, releaseDirFrom } from "./lib/release-dir.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
};

const releaseDir = releaseDirFrom(args);

/*
 * --key, then the environment, then the one documented location. The fallback
 * is not convenience: it is what makes a one-command ship work from any shell.
 * A shell that never loaded a profile (an agent's shell, a fresh terminal, a
 * task runner) would otherwise fail with "no private key given" while the key
 * sits exactly where the runbook says it does.
 *
 * The key is still never read from the repo, and a missing file still refuses.
 */
const DEFAULT_KEY_PATH = join(
  process.env.USERPROFILE ?? process.env.HOME ?? "",
  ".struq",
  "struq-voice-release-private.pem"
);
const keyPath = flag(
  "key",
  process.env.STRUQ_VOICE_RELEASE_KEY ||
    (existsSync(DEFAULT_KEY_PATH) ? DEFAULT_KEY_PATH : "")
);

function fail(message, hint) {
  console.error(`sign-release: FAIL - ${message}`);
  if (hint) console.error(`\n${hint}`);
  process.exit(1);
}

/* The refusal is the point. A signer that warns and continues on a missing key
   produces an unsigned release on exactly the evening nobody is reading output,
   and the whole chain's guarantee is that an unsigned artifact never exists. */
if (!keyPath) {
  fail(
    "no private key given",
    [
      "Pass --key <path>, or set STRUQ_VOICE_RELEASE_KEY to the private key path.",
      `The key belongs at ${DEFAULT_KEY_PATH} and never in this repository.`,
      "",
      "This script refuses rather than producing an unsigned release, because an",
      "unsigned artifact on the feed is the exact thing the signature prevents."
    ].join("\n")
  );
}
if (!existsSync(keyPath)) fail(`no private key at ${keyPath}`);
if (!existsSync(releaseDir)) {
  fail(`no release directory at ${releaseDir}`, "Run `pnpm dist` first.");
}

/* The installer is found rather than named, so a version bump does not have to
   be typed here as well as in package.json. */
const installers = readdirSync(releaseDir).filter(
  (name) => name.endsWith(".exe") && !name.includes("elevate")
);
if (installers.length === 0) fail(`no .exe installer in ${releaseDir}`);
if (installers.length > 1) {
  fail(
    `found ${installers.length} installers in ${releaseDir}: ${installers.join(", ")}`,
    "Clear the directory and rebuild, so there is no doubt which one is signed."
  );
}

const file = installers[0];
const version = JSON.parse(readFileSync(resolve("package.json"), "utf8")).version;

const sha512 = createHash("sha512").update(readFileSync(join(releaseDir, file))).digest("hex");

/* The message shape, restated here rather than imported. See the header. */
const message = `${sha512}|${version}`;

let signature;
try {
  const privateKey = createPrivateKey(readFileSync(keyPath, "utf8"));
  if (privateKey.asymmetricKeyType !== "ed25519") {
    fail(`the key at ${keyPath} is ${privateKey.asymmetricKeyType}, expected ed25519`);
  }
  signature = cryptoSign(null, Buffer.from(message, "utf8"), privateKey).toString("base64");
} catch (error) {
  fail(`could not sign with the key at ${keyPath}: ${error.message}`);
}

const manifest = { version, file, sha512, signature };
writeFileSync(join(releaseDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`sign-release: OK`);
console.log(`  version   ${version}`);
console.log(`  file      ${file}`);
console.log(`  sha512    ${sha512.slice(0, 32)}...`);
console.log(`  manifest  ${join(releaseDir, MANIFEST_FILE)}`);
