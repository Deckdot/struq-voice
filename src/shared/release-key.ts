/**
 * The public half of the release signing keypair.
 *
 * WHAT THIS IS: every update Struq Voice installs must carry an Ed25519
 * signature made with the matching PRIVATE key, which lives at
 * `~/.struq/struq-voice-release-private.pem` and has never been in this
 * repository. The updater verifies against this constant before it lets
 * electron-updater install anything, and a failed check aborts rather than
 * warns.
 *
 * WHY IT MATTERS: Struq Voice ships without a code signing certificate. That
 * is safe while the only way onto a machine is running an installer you were
 * handed. An update channel replaces that with "download what is at this URL
 * and execute it". On Windows electron-updater authenticates an update by
 * comparing the installed binary's publisherName against the update
 * certificate's Common Name; with no certificate there is nothing to compare,
 * and there is a known bypass of that check even when there is
 * (CVE-2024-39698). This key is the whole of the trust, not a second layer on
 * top of one.
 *
 * DO NOT EDIT OR DELETE THIS VALUE. Rotating it means every installed copy
 * stops accepting updates, because each one verifies against the key it was
 * built with. A rotation therefore requires a hand-delivered build to every
 * machine, exactly like the first install did.
 *
 * Format: base64 of the SPKI DER encoding, which is what
 * `crypto.createPublicKey({ format: "der", type: "spki" })` accepts directly.
 */
export const RELEASE_PUBLIC_KEY_B64 =
  "MCowBQYDK2VwAyEAbHFQihYSBYsyLXleXVFG1DyLiPPiCZP5mgSwraxi/zs=";

/**
 * The signed message is `<sha512-hex>|<version>`, and the version is in it on
 * purpose. A signature over the hash alone would let an attacker re-serve a
 * genuinely signed older build with a known bug in it: the bytes are authentic,
 * the signature verifies, and the app downgrades itself into the hole. Binding
 * the version is what makes that fail.
 *
 * The signer and the verifier are separate scripts that deliberately share no
 * code, so this shape is stated here and restated in each of them rather than
 * imported: a helper both sides call proves only that the helper agrees with
 * itself. If both were wrong in the same way, a shared-code test still passes
 * and the protection is imaginary.
 */
export function signedMessage(sha512Hex: string, version: string): string {
  return `${sha512Hex}|${version}`;
}

/** The manifest the signer writes beside the installer. */
export interface ReleaseManifest {
  readonly version: string;
  readonly file: string;
  readonly sha512: string;
  readonly signature: string;
}

/** Manifest file name, read by the updater and written by the signer. */
export const RELEASE_MANIFEST_FILE = "struq-voice-release.json";
