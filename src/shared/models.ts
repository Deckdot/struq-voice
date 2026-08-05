/**
 * The model catalog shared by main and renderer. Side-effect free and
 * Electron-free so both surfaces can import it safely. Sizes and sha256
 * hashes are sourced from the Hugging Face repo trees for
 * sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8 and
 * sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8. Files without a published hash
 * (plain, non-LFS text files) use 64 hex zeros.
 */

export interface ModelFile {
  path: string;
  url: string;
  bytes: number;
  sha256: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  engine: "parakeet";
  bytes: number;
  languages: string;
  whenToUse: string;
  license: string;
  files: readonly ModelFile[];
}

export type ModelDownloadState =
  | { state: "idle" }
  | { state: "downloading"; receivedBytes: number; totalBytes: number }
  | { state: "verifying" }
  | { state: "done" }
  | { state: "error"; message: string };

export interface ModelStatus {
  model: ModelInfo;
  installed: boolean;
  installedBytes: number;
  download: ModelDownloadState;
}

const HF_RESOLVE_ROOT = "https://huggingface.co/csukuangfj";

function file(
  model: string,
  path: string,
  bytes: number,
  sha256: string
): ModelFile {
  return {
    path,
    url: `${HF_RESOLVE_ROOT}/${model}/resolve/main/${path}`,
    bytes,
    sha256
  };
}

const ZERO_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

export const MODEL_CATALOG: readonly ModelInfo[] = [
  {
    id: "parakeet-tdt-0.6b-v3-int8",
    name: "Parakeet TDT 0.6B v3",
    engine: "parakeet",
    bytes: 670478772,
    languages: "25 European languages incl. English, Dutch, German, French, Spanish",
    whenToUse: "Default. Best multilingual accuracy.",
    license: "Apache 2.0 (NVIDIA)",
    files: [
      file(
        "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
        "encoder.int8.onnx",
        652184281,
        "acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247"
      ),
      file(
        "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
        "decoder.int8.onnx",
        11845275,
        "179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e"
      ),
      file(
        "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
        "joiner.int8.onnx",
        6355277,
        "3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3"
      ),
      file(
        "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
        "tokens.txt",
        93939,
        ZERO_HASH
      )
    ]
  },
  {
    id: "parakeet-tdt-0.6b-v2-int8",
    name: "Parakeet TDT 0.6B v2",
    engine: "parakeet",
    bytes: 661190513,
    languages: "English",
    whenToUse: "English with stronger punctuation and casing.",
    license: "Apache 2.0 (NVIDIA)",
    files: [
      file(
        "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8",
        "encoder.int8.onnx",
        652184296,
        "a32b12d17bbbc309d0686fbbcc2987b5e9b8333a7da83fa6b089f0a2acd651ab"
      ),
      file(
        "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8",
        "decoder.int8.onnx",
        7257753,
        "b6bb64963457237b900e496ee9994b59294526439fbcc1fecf705b31a15c6b4e"
      ),
      file(
        "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8",
        "joiner.int8.onnx",
        1739080,
        "7946164367946e7f9f29a122407c3252b680dbae9a51343eb2488d057c3c43d2"
      ),
      file(
        "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8",
        "tokens.txt",
        9384,
        ZERO_HASH
      )
    ]
  }
];

export function findModel(id: string): ModelInfo | null {
  return MODEL_CATALOG.find((model) => model.id === id) ?? null;
}
