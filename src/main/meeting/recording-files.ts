/**
 * Removing a meeting's recording from disk.
 *
 * Deleting a meeting and the retention sweep both have to do this, and only
 * the sweep used to: every meeting deleted from the library left its
 * recording behind forever, invisible to the UI and unreachable by any
 * channel. Hundreds of megabytes of meeting audio the user believed they had
 * deleted. One helper so the two paths cannot diverge again.
 */

import { rm } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Deletes the directory holding a meeting's recording.
 *
 * `audioPath` is the recording file; each meeting owns its directory
 * (`meetings/<id>/recording.webm`), so the parent is what goes. Never
 * throws: a recording that cannot be removed is a disk-space problem, not a
 * reason to fail the delete the user asked for.
 */
export const removeRecordingDirectory = async (
  audioPath: string | null
): Promise<void> => {
  if (audioPath === null || audioPath.length === 0) return;
  try {
    await rm(dirname(audioPath), { recursive: true, force: true });
  } catch (error) {
    console.warn("[meeting] Could not delete the recording directory.", error);
  }
};
