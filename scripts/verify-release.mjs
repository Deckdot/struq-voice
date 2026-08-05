#!/usr/bin/env node
/**
 * verify-release: check a signed release the way the app will.
 *
 * This is the INDEPENDENT verifier, and independence is the whole point of it
 * existing separately from sign-release.mjs. A verifier that imports the
 * signer's own helpers proves that the helpers agree with themselves and
 * nothing more: if the message shape is wrong in both, or the hash is computed
 * over the wrong bytes in both, a shared-code check passes and the protection
 * is imaginary.
 *
 * So this file shares nothing with the signer. It re-reads the artifact from
 * disk, re-computes the hash itself, rebuilds the signed message from its own
 * literal, and reads the public key out of `src/shared/release-key.ts` as text
 * so it checks the key the shipped build will actually use.
 *
 * It checks three things, and names which one failed:
 *
 *   1. HASH      the bytes on disk hash to what the manifest claims
 *   2. VERSION   the manifest version matches package.json
 *   3. SIGNATURE the signature covers `<sha512>|<version>` under the public key
 *
 * All three matter and they fail differently. A bad hash is a corrupted or
 * swapped artifact. A version mismatch is a replay of an older signed build. A
 * bad signature is a forgery attempt or the wrong key.
 *
 * Run: node scripts/verify-release.mjs [--dir <path>]
 */
import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { MANIFEST_FILE, releaseDirFrom } from "./lib/release-dir.mjs";

const args = process.argv.slice(2);
const releaseDir = releaseDirFrom(args);

const failures = [];
const fail = (check, detail) => failures.push(`${check}: ${detail}`);

function die(message) {
  console.error(`verify-release: FAIL - ${message}`);
  process.exit(1);
}

const manifestPath = join(releaseDir, MANIFEST_FILE);
if (!existsSync(manifestPath)) {
  die(`no manifest at ${manifestPath}. Run \`node scripts/sign-release.mjs\` first.`);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  die(`manifest is not valid JSON: ${error.message}`);
}

for (const field of ["version", "file", "sha512", "signature"]) {
  if (!manifest[field]) die(`manifest is missing "${field}"`);
}

const artifactPath = join(releaseDir, manifest.file);
if (!existsSync(artifactPath)) {
  die(`manifest names ${manifest.file}, which is not in ${releaseDir}`);
}

/* 1. HASH. Computed here from the bytes on disk, never taken from the manifest.
      Reading the claim and echoing it back would verify nothing at all. */
const actualSha512 = createHash("sha512").update(readFileSync(artifactPath)).digest("hex");
if (actualSha512 !== manifest.sha512) {
  fail(
    "hash",
    `the artifact hashes to ${actualSha512.slice(0, 32)}... but the manifest claims ${String(
      manifest.sha512
    ).slice(0, 32)}...`
  );
}

/* 2. VERSION. The signed message binds the version, so a mismatch here is what
      a downgrade replay looks like: authentic bytes, real signature, wrong build. */
const packageVersion = JSON.parse(readFileSync(resolve("package.json"), "utf8")).version;
if (manifest.version !== packageVersion) {
  fail("version", `manifest says ${manifest.version}, package.json says ${packageVersion}`);
}

/* 3. SIGNATURE. The public key is read as TEXT out of the app's own module, so
      this checks the key the shipped build will use. Importing the module would
      need a TypeScript loader in a plain node script; a regex over one base64
      constant is the smaller dependency. */
const keySource = readFileSync(resolve("src/shared/release-key.ts"), "utf8");
const keyMatch = keySource.match(/RELEASE_PUBLIC_KEY_B64\s*=\s*\n?\s*"([A-Za-z0-9+/=]+)"/);
if (!keyMatch) die("could not read RELEASE_PUBLIC_KEY_B64 out of src/shared/release-key.ts");

/* The message shape, restated from its own literal. See the header. */
const message = `${actualSha512}|${manifest.version}`;

let valid = false;
try {
  const publicKey = createPublicKey({
    key: Buffer.from(keyMatch[1], "base64"),
    format: "der",
    type: "spki"
  });
  valid = cryptoVerify(
    null,
    Buffer.from(message, "utf8"),
    publicKey,
    Buffer.from(manifest.signature, "base64")
  );
} catch (error) {
  fail("signature", `the check could not run: ${error.message}`);
}
if (!valid && failures.every((entry) => !entry.startsWith("signature"))) {
  fail("signature", "does not verify under the public key in src/shared/release-key.ts");
}

if (failures.length > 0) {
  console.error("verify-release: FAIL");
  for (const entry of failures) console.error(`  ${entry}`);
  console.error("\nNothing should be published until every check passes.");
  process.exit(1);
}

console.log("verify-release: OK");
console.log(`  version    ${manifest.version}`);
console.log(`  file       ${manifest.file}`);
console.log(`  hash       verified over ${readFileSync(artifactPath).length} bytes`);
console.log(`  signature  verifies under the shipped public key`);
