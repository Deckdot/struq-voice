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
  engine: "parakeet" | "whisper-cpp";
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
const HF_WHISPER_ROOT = "https://huggingface.co/ggerganov/whisper.cpp";

function file(
  repo: string,
  path: string,
  bytes: number,
  sha256: string,
  root: string = HF_RESOLVE_ROOT
): ModelFile {
  return {
    path,
    url: `${root}/${repo}/resolve/main/${path}`,
    bytes,
    sha256
  };
}

const ZERO_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

/** Whisper size tiers, smallest to largest. Used to order and label the catalog. */
export type WhisperTier = "tiny" | "base" | "small" | "medium" | "large";

export interface WhisperVariant {
  /** ggml file name in the ggerganov/whisper.cpp repo. */
  readonly fileName: string;
  readonly bytes: number;
  readonly sha256: string;
  /** Quantisation label, or null for the full-precision weights. */
  readonly quant: string | null;
  readonly tier: WhisperTier;
  /** English-only builds are smaller and better at English, useless elsewhere. */
  readonly englishOnly: boolean;
}

/**
 * Every whisper.cpp ggml build we offer, from tiny to large. Sizes and sha256
 * hashes come from the Hugging Face API tree for ggerganov/whisper.cpp, so the
 * downloader can verify each file. Quantised builds (q5_1, q8_0, q5_0) trade a
 * little accuracy for a much smaller download and less RAM.
 */
const WHISPER_VARIANTS: readonly WhisperVariant[] = [
  { fileName: "ggml-tiny-q5_1.bin", bytes: 32152673, sha256: "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7", quant: "q5_1", tier: "tiny", englishOnly: false },
  { fileName: "ggml-tiny.en-q5_1.bin", bytes: 32166155, sha256: "c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b", quant: "q5_1", tier: "tiny", englishOnly: true },
  { fileName: "ggml-tiny-q8_0.bin", bytes: 43537433, sha256: "c2085835d3f50733e2ff6e4b41ae8a2b8d8110461e18821b09a15c40c42d1cca", quant: "q8_0", tier: "tiny", englishOnly: false },
  { fileName: "ggml-tiny.bin", bytes: 77691713, sha256: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21", quant: null, tier: "tiny", englishOnly: false },
  { fileName: "ggml-tiny.en.bin", bytes: 77704715, sha256: "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f", quant: null, tier: "tiny", englishOnly: true },

  { fileName: "ggml-base-q5_1.bin", bytes: 59707625, sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898", quant: "q5_1", tier: "base", englishOnly: false },
  { fileName: "ggml-base.en-q5_1.bin", bytes: 59721011, sha256: "4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f", quant: "q5_1", tier: "base", englishOnly: true },
  { fileName: "ggml-base-q8_0.bin", bytes: 81768585, sha256: "c577b9a86e7e048a0b7eada054f4dd79a56bbfa911fbdacf900ac5b567cbb7d9", quant: "q8_0", tier: "base", englishOnly: false },
  { fileName: "ggml-base.bin", bytes: 147951465, sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe", quant: null, tier: "base", englishOnly: false },
  { fileName: "ggml-base.en.bin", bytes: 147964211, sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002", quant: null, tier: "base", englishOnly: true },

  { fileName: "ggml-small-q5_1.bin", bytes: 190085487, sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb", quant: "q5_1", tier: "small", englishOnly: false },
  { fileName: "ggml-small.en-q5_1.bin", bytes: 190098681, sha256: "bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30", quant: "q5_1", tier: "small", englishOnly: true },
  { fileName: "ggml-small-q8_0.bin", bytes: 264464607, sha256: "49c8fb02b65e6049d5fa6c04f81f53b867b5ec9540406812c643f177317f779f", quant: "q8_0", tier: "small", englishOnly: false },
  { fileName: "ggml-small.bin", bytes: 487601967, sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b", quant: null, tier: "small", englishOnly: false },
  { fileName: "ggml-small.en.bin", bytes: 487614201, sha256: "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d", quant: null, tier: "small", englishOnly: true },

  { fileName: "ggml-medium-q5_0.bin", bytes: 539212467, sha256: "19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f", quant: "q5_0", tier: "medium", englishOnly: false },
  { fileName: "ggml-medium.en-q5_0.bin", bytes: 539225533, sha256: "76733e26ad8fe1c7a5bf7531a9d41917b2adc0f20f2e4f5531688a8c6cd88eb0", quant: "q5_0", tier: "medium", englishOnly: true },
  { fileName: "ggml-medium-q8_0.bin", bytes: 823369779, sha256: "42a1ffcbe4167d224232443396968db4d02d4e8e87e213d3ee2e03095dea6502", quant: "q8_0", tier: "medium", englishOnly: false },
  { fileName: "ggml-medium.bin", bytes: 1533763059, sha256: "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208", quant: null, tier: "medium", englishOnly: false },
  { fileName: "ggml-medium.en.bin", bytes: 1533774781, sha256: "cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356", quant: null, tier: "medium", englishOnly: true },

  { fileName: "ggml-large-v3-turbo-q5_0.bin", bytes: 574041195, sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2", quant: "q5_0", tier: "large", englishOnly: false },
  { fileName: "ggml-large-v3-turbo-q8_0.bin", bytes: 874188075, sha256: "317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1", quant: "q8_0", tier: "large", englishOnly: false },
  { fileName: "ggml-large-v3-q5_0.bin", bytes: 1081140203, sha256: "d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1", quant: "q5_0", tier: "large", englishOnly: false },
  { fileName: "ggml-large-v2-q5_0.bin", bytes: 1080732091, sha256: "3a214837221e4530dbc1fe8d734f302af393eb30bd0ed046042ebf4baf70f6f2", quant: "q5_0", tier: "large", englishOnly: false },
  { fileName: "ggml-large-v2-q8_0.bin", bytes: 1656129691, sha256: "fef54e6d898246a65c8285bfa83bd1807e27fadf54d5d4e81754c47634737e8c", quant: "q8_0", tier: "large", englishOnly: false },
  { fileName: "ggml-large-v3-turbo.bin", bytes: 1624555275, sha256: "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69", quant: null, tier: "large", englishOnly: false },
  { fileName: "ggml-large-v3.bin", bytes: 3095033483, sha256: "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2", quant: null, tier: "large", englishOnly: false },
  { fileName: "ggml-large-v2.bin", bytes: 3094623691, sha256: "9a423fe4d40c82774b6af34115b8b935f34152246eb19e80e376071d3f999487", quant: null, tier: "large", englishOnly: false },
  { fileName: "ggml-large-v1.bin", bytes: 3094623691, sha256: "7d99f41a10525d0206bddadd86760181fa920438b6b33237e3118ff6c83bb53d", quant: null, tier: "large", englishOnly: false }
];

const TIER_GUIDANCE: Record<WhisperTier, string> = {
  tiny: "Fastest and smallest. Draft quality; expect mistakes on accents and noise.",
  base: "Light and quick. Fine for clear speech on a modest machine.",
  small: "The usual sweet spot: solid accuracy without a long wait.",
  medium: "High accuracy. Noticeably slower and needs more RAM.",
  large: "Best accuracy available. Slowest, and the full builds are multi-GB."
};

const QUANT_GUIDANCE: Record<string, string> = {
  q5_1: "Heavily compressed, smallest download.",
  q5_0: "Heavily compressed, smallest download.",
  q8_0: "Lightly compressed, closer to full accuracy."
};

/** "ggml-large-v3-turbo-q5_0.bin" becomes "large-v3-turbo". */
const variantLabel = (fileName: string): string =>
  fileName
    .replace(/^ggml-/, "")
    .replace(/\.bin$/, "")
    .replace(/-q[58]_[01]$/, "")
    .replace(/\.en$/, "");

const buildWhisperModel = (variant: WhisperVariant): ModelInfo => {
  const base = variantLabel(variant.fileName);
  const quantSuffix = variant.quant === null ? "" : ` (${variant.quant})`;
  const englishSuffix = variant.englishOnly ? " English-only" : "";
  const quantNote = variant.quant === null
    ? "Full precision weights."
    : QUANT_GUIDANCE[variant.quant] ?? "Quantised build.";

  return {
    id: `whisper-${variant.fileName.replace(/^ggml-/, "").replace(/\.bin$/, "")}`,
    name: `Whisper ${base}${englishSuffix}${quantSuffix}`,
    engine: "whisper-cpp",
    bytes: variant.bytes,
    languages: variant.englishOnly ? "English only" : "99 languages",
    whenToUse: `${TIER_GUIDANCE[variant.tier]} ${quantNote}`,
    license: "MIT (OpenAI weights)",
    files: [
      file(variant.fileName, variant.fileName, variant.bytes, variant.sha256, HF_WHISPER_ROOT)
    ]
  };
};

const WHISPER_MODELS: readonly ModelInfo[] = WHISPER_VARIANTS.map(buildWhisperModel);

/** Model id to its whisper variant, for grouping and filtering in the UI. */
const WHISPER_BY_ID = new Map<string, WhisperVariant>(
  WHISPER_VARIANTS.map((variant) => [
    `whisper-${variant.fileName.replace(/^ggml-/, "").replace(/\.bin$/, "")}`,
    variant
  ])
);

export const whisperVariant = (modelId: string): WhisperVariant | null =>
  WHISPER_BY_ID.get(modelId) ?? null;

/** Smallest to largest, for ordering the Models view. */
export const WHISPER_TIER_ORDER: readonly WhisperTier[] = [
  "tiny",
  "base",
  "small",
  "medium",
  "large"
];

/**
 * The whisper model installed by default when none is present. base-q5_1 is
 * 60MB, runs comfortably on any machine and is multilingual, which makes it
 * the safest thing to hand someone before they have picked a size.
 */
export const DEFAULT_WHISPER_MODEL_ID = "whisper-base-q5_1";

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
  },
  ...WHISPER_MODELS
];

export function findModel(id: string): ModelInfo | null {
  return MODEL_CATALOG.find((model) => model.id === id) ?? null;
}
