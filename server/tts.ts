/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { readDaemonConfig, requiredFiles, resolveVoice, type ResolvedVoice, type TtsEngine } from "./voices";

type SpeechFile = { base64: string; mimeType: string };
type LocalVoice = Extract<ResolvedVoice, { provider: "local" }>;
type OpenAiVoice = Extract<ResolvedVoice, { provider: "openai" }>;

const PLUGIN_ID = "read-aloud";

// ---------- OpenAI ----------

async function synthesizeOpenAi(voice: OpenAiVoice, text: string): Promise<SpeechFile> {
  if (!voice.apiKey) {
    throw new Error("OpenAI TTS is selected in Paseo's voice settings but no API key is configured");
  }
  const request = fetch(voice.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${voice.apiKey}` },
    body: JSON.stringify({ model: voice.model, voice: voice.voice, input: text, response_format: "mp3" }),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("OpenAI TTS request timed out")), 60_000);
  });
  const response = await Promise.race([request, timeout]).finally(() => clearTimeout(timer));
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200).trim();
    throw new Error(`OpenAI TTS request failed (${response.status})${detail ? ": " + detail : ""}`);
  }
  return { base64: Buffer.from(await response.arrayBuffer()).toString("base64"), mimeType: "audio/mpeg" };
}

// ---------- Local voices ----------

type Audio = { samples: Float32Array | number[]; sampleRate: number };
interface LocalEngine {
  generate(text: string, sid: number, speed: number): Promise<Audio>;
}

/** The engine block of sherpa's TTS config, built the way Paseo's voice mode builds it. */
function modelBlock(dir: string, engine: TtsEngine) {
  const file = (name: string) => path.join(dir, name);
  const shared = { model: file(engine.model), tokens: file(engine.tokens), lengthScale: 1.0 };
  switch (engine.family) {
    case "kokoro":
      return {
        kokoro: {
          ...shared,
          voices: file(engine.voices ?? "voices.bin"),
          dataDir: engine.dataDir ? file(engine.dataDir) : "",
          lexicon: (engine.lexicons ?? []).map(file).join(","),
          dictDir: engine.dictDir ? file(engine.dictDir) : "",
        },
      };
    case "kitten":
      return { kitten: { ...shared, voices: file(engine.voices ?? "voices.bin"), dataDir: engine.dataDir ? file(engine.dataDir) : "" } };
    case "vits":
      return { vits: { ...shared, dataDir: engine.dataDir ? file(engine.dataDir) : "" } };
  }
}

/**
 * Paseo's own native sherpa-onnx runtime, the one its voice mode uses. Plugin server bundles run
 * with Paseo's module resolver, so a non-literal require reaches it. It is fast and asynchronous.
 */
function nativeEngine(voice: LocalVoice): LocalEngine | null {
  const specifier = ["sherpa-onnx", "node"].join("-");
  let sherpa: { OfflineTts?: new (config: unknown) => { generateAsync(input: object): Promise<Audio> } };
  try {
    sherpa = require(specifier);
  } catch {
    return null;
  }
  if (typeof sherpa.OfflineTts !== "function") return null;
  const tts = new sherpa.OfflineTts({
    model: { numThreads: 2, debug: false, provider: "cpu", ...modelBlock(voice.dir, voice.engine) },
    maxNumSentences: 1,
    ruleFsts: voice.engine.family === "kokoro" ? (voice.engine.ruleFsts ?? []).map((name) => path.join(voice.dir, name)).join(",") : "",
  });
  return {
    // Electron rejects native external buffers, so ask sherpa for a copied array.
    generate: (text, sid, speed) => tts.generateAsync({ text, sid, speed, enableExternalBuffer: false }),
  };
}

/** Where Paseo installed this plugin: config.json records the directory for every source kind. */
function pluginDirectory(): string | null {
  const plugins = readDaemonConfig().plugins ?? {};
  for (const entry of [plugins[PLUGIN_ID], ...Object.values(plugins)]) {
    if (entry?.enabled === false) continue;
    const dir = typeof entry?.path === "string" ? entry.path : null;
    if (!dir) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, "paseo-plugin.json"), "utf8")) as { id?: string };
      if (manifest.id === PLUGIN_ID && fs.existsSync(path.join(dir, "node_modules", "sherpa-onnx"))) return dir;
    } catch {
      // Not this plugin.
    }
  }
  return null;
}

/** Fallback: the plugin's own WebAssembly build of sherpa-onnx (slower, blocks while generating). */
function wasmEngine(voice: LocalVoice): LocalEngine {
  const home = pluginDirectory();
  if (!home) throw new Error("Read Aloud could not find its installed files to load the speech engine.");
  // The bundle has no import.meta or __dirname, so resolve from the installed plugin directory.
  const sherpa = createRequire(path.join(home, "package.json"))("sherpa-onnx") as {
    createOfflineTts(config: unknown): { generate(input: object): Audio };
  };
  const block = modelBlock(voice.dir, voice.engine);
  const wasmBlock =
    "kokoro" in block ? { offlineTtsKokoroModelConfig: { ...block.kokoro, lang: "" } }
    : "kitten" in block ? { offlineTtsKittenModelConfig: block.kitten }
    : { offlineTtsVitsModelConfig: { ...block.vits, lexicon: "", noiseScale: 0.667, noiseScaleW: 0.8 } };
  const tts = sherpa.createOfflineTts({ offlineTtsModelConfig: { numThreads: 1, debug: false, ...wasmBlock } });
  return { generate: async (text, sid, speed) => tts.generate({ text, sid, speed }) };
}

let engine: { key: string; ready: Promise<LocalEngine> } | null = null;
/** The last voice that failed to load, so the status check can report it. */
let engineError: { key: string; message: string } | null = null;
/** The native handle is not reentrant: run one generation at a time. */
let queue: Promise<unknown> = Promise.resolve();

function localEngine(voice: LocalVoice): Promise<LocalEngine> {
  const key = voice.dir + "|" + voice.modelId;
  if (engine?.key === key) return engine.ready;
  const ready = (async () => {
    const missing = requiredFiles(voice.engine).filter((name) => !fs.existsSync(path.join(voice.dir, name)));
    if (missing.length) {
      throw new Error(`Paseo's voice '${voice.label}' is not downloaded. Download it in Paseo Settings > Voice.`);
    }
    return nativeEngine(voice) ?? wasmEngine(voice);
  })();
  engine = { key, ready };
  // A failure is not cached: the next press tries again (for example after downloading the voice).
  ready.then(
    () => {
      if (engineError?.key === key) engineError = null;
    },
    (error: unknown) => {
      if (engine?.ready === ready) engine = null;
      const missing = requiredFiles(voice.engine).some((name) => !fs.existsSync(path.join(voice.dir, name)));
      if (!missing) engineError = { key, message: error instanceof Error ? error.message : String(error) };
    },
  );
  return ready;
}

/** Float32 samples in -1..1 to a 16-bit PCM mono WAV file. */
function encodeWav(samples: ArrayLike<number>, sampleRate: number): Buffer {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(value < 0 ? value * 0x8000 : value * 0x7fff), 44 + i * 2);
  }
  return buffer;
}

async function synthesizeLocal(voice: LocalVoice, text: string): Promise<SpeechFile> {
  const local = await localEngine(voice);
  const run = queue.then(() => local.generate(text, voice.speakerId, voice.speed));
  queue = run.catch(() => undefined);
  const audio = await run;
  return { base64: encodeWav(audio.samples, audio.sampleRate).toString("base64"), mimeType: "audio/wav" };
}

/** Speaks one chunk with the voice chosen in Paseo's voice settings. */
export async function synthesize({ text }: { text: string }): Promise<SpeechFile> {
  if (!text.trim()) throw new Error("Nothing to read aloud");
  const voice = resolveVoice();
  return voice.provider === "openai" ? synthesizeOpenAi(voice, text) : synthesizeLocal(voice, text);
}

const SPEAKING_SETTINGS = "Open Paseo Settings, choose Voice, and find Voice mode > Speaking.";

/** Checks the voice Paseo would use, without loading it, and says how to fix any problem. */
export async function checkVoice(): Promise<{ ok: boolean; voice: string; problem?: string; steps?: string[] }> {
  let voice: ResolvedVoice;
  try {
    voice = resolveVoice();
  } catch (error) {
    return {
      ok: false,
      voice: "Unknown voice",
      problem: error instanceof Error ? error.message : "Paseo's voice settings couldn't be read.",
      steps: [SPEAKING_SETTINGS, "Set Provider to Local or OpenAI and pick a voice from the Model list.", "Tap this warning again to re-check."],
    };
  }
  if (voice.provider === "openai") {
    if (voice.apiKey) return { ok: true, voice: `OpenAI ${voice.voice}` };
    return {
      ok: false,
      voice: `OpenAI ${voice.voice}`,
      problem: "OpenAI is selected for speaking, but no API key is saved.",
      steps: [SPEAKING_SETTINGS, "Enter your OpenAI API key and press Save, or switch Provider to Local.", "Tap this warning again to re-check."],
    };
  }
  const missing = requiredFiles(voice.engine).filter((name) => !fs.existsSync(path.join(voice.dir, name)));
  if (missing.length) {
    return {
      ok: false,
      voice: voice.label,
      problem: `The selected voice, ${voice.label}, isn't downloaded.`,
      steps: [
        SPEAKING_SETTINGS,
        `Next to ${voice.label}, press Download and wait until it shows Downloaded.`,
        "Or pick another voice that's already downloaded from the Model list.",
        "Tap this warning again to re-check.",
      ],
    };
  }
  if (engineError?.key === voice.dir + "|" + voice.modelId) {
    return {
      ok: false,
      voice: voice.label,
      problem: `${voice.label} is downloaded but couldn't be loaded: ${engineError.message}`,
      steps: [
        SPEAKING_SETTINGS,
        `Delete ${voice.label}, download it again, then tap this warning to re-check.`,
        "If it still fails, pick a different voice from the Model list.",
      ],
    };
  }
  return { ok: true, voice: voice.label };
}
