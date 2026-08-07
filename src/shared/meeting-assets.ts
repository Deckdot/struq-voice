/**
 * The support models a meeting needs beyond the ASR engine: voice activity
 * detection, speaker embedding, and speaker segmentation. Kept out of
 * MODEL_CATALOG so the Models view stays a page about transcription quality;
 * these are installed once from the Meetings page and never chosen between.
 *
 * Sizes and sha256 hashes come from the Hugging Face API trees for
 * csukuangfj/vad, csukuangfj/speaker-embedding-models and
 * csukuangfj/sherpa-onnx-pyannote-segmentation-3-0.
 */

import type { DownloadBundle } from "./models";

export type MeetingAssetId =
  | "meeting-vad-silero"
  | "meeting-embedding-campplus-en"
  | "meeting-segmentation-pyannote";

export interface MeetingAsset extends DownloadBundle {
  readonly id: MeetingAssetId;
  readonly role: "vad" | "embedding" | "segmentation";
  /** Shown on the install card in the Meetings page. */
  readonly purpose: string;
  readonly license: string;
  /** False for the segmentation model: refinement is optional. */
  readonly required: boolean;
}

export const MEETING_ASSETS: readonly MeetingAsset[] = [
  {
    id: "meeting-vad-silero",
    name: "Silero voice activity detection",
    role: "vad",
    purpose: "Finds where speech starts and stops, so silence is never decoded.",
    license: "MIT",
    required: true,
    bytes: 1_807_522,
    files: [
      {
        path: "silero_vad.onnx",
        url: "https://huggingface.co/csukuangfj/vad/resolve/main/silero_vad.onnx",
        bytes: 1_807_522,
        sha256: "a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28"
      }
    ]
  },
  {
    id: "meeting-embedding-campplus-en",
    name: "CAM++ speaker embedding",
    role: "embedding",
    purpose: "Turns a voice into a fingerprint, so the same person keeps the same label.",
    license: "Apache 2.0 (3D-Speaker)",
    required: true,
    bytes: 29_596_978,
    files: [
      {
        path: "3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx",
        url: "https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/main/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx",
        bytes: 29_596_978,
        sha256: "357a834f702b80161e5b981182c038e18553c1f2ca752ed6cec2052365d4129b"
      }
    ]
  },
  {
    id: "meeting-segmentation-pyannote",
    name: "Pyannote speaker segmentation",
    role: "segmentation",
    purpose: "Splits a long turn when two people talk over each other.",
    license: "MIT (pyannote)",
    required: false,
    bytes: 5_992_913,
    files: [
      {
        path: "model.onnx",
        url: "https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.onnx",
        bytes: 5_992_913,
        sha256: "220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079"
      }
    ]
  }
];

export const findMeetingAsset = (id: string): MeetingAsset | null =>
  MEETING_ASSETS.find((asset) => asset.id === id) ?? null;

/** Total bytes a first-time install of the required assets costs. */
export const REQUIRED_ASSET_BYTES = MEETING_ASSETS.filter(
  (asset) => asset.required
).reduce((sum, asset) => sum + asset.bytes, 0);
