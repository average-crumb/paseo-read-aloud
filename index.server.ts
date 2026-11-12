import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { SherpaOfflineTts } from "sherpa-onnx";
import { synthesizeSpeech, truncateForReadAloud } from "./shared/speech";
import type { RpcInput } from "@getpaseo/plugin";

interface LocalTtsConfig {
  provider?: "local";
  model?: string;
  speakerId?: number;
  speed?: number;
}

interface OpenAiTtsConfig {
  provider: "openai";
  model?: string;
  voice?: string;
  baseUrl?: string;
  apiKey?: string;
}

type TtsConfig = LocalTtsConfig | OpenAiTtsConfig;

function paseoHome(): string {
  return process.env.PASEO_HOME ?? path.join(os.homedir(), ".paseo");
}

/**
 * Reads the daemon config file directly (config.get() masks API keys, and
 * server code is trusted Node code) and returns `features.voiceMode.tts`,
 * or local defaults when absent.
 */
function readTtsConfig(): TtsConfig {
  const file = path.join(paseoHome(), "config.json");
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      features?: { voiceMode?: { tts?: unknown } };
    };
    const tts = raw.features?.voiceMode?.tts;
    if (tts && typeof tts === "object") {
      return tts as TtsConfig;
    }
  } catch {
    // Config missing or unreadable: fall back to local defaults.
  }
  return {};
}

async function synthesizeOpenAi(tts: OpenAiTtsConfig, text: string): Promise<{ base64: string; mimeType: string }> {
  const apiKey = tts.apiKey || process.env.OPENAI_TTS_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OpenAI TTS is selected in Paseo's voice settings but no API key is configured",
    );
  }
  const baseUrl =
    tts.baseUrl ||
    process.env.OPENAI_TTS_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    "https://api.openai.com";
  const response = await fetch(`${baseUrl}/v1/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: tts.model || "tts-1",
      voice: tts.voice || "alloy",
      input: text,
      response_format: "mp3",
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI TTS request failed with status ${response.status}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  return { base64: body.toString("base64"), mimeType: "audio/mpeg" };
}

/** Lazy-init the Kokoro TTS handle once; concurrent requests queue on this promise. */
let kokoroPromise: Promise<SherpaOfflineTts> | null = null;

function getKokoro(): Promise<SherpaOfflineTts> {
  if (kokoroPromise) return kokoroPromise;
  kokoroPromise = (async () => {
    const tts = readTtsConfig();
    const model = tts.model && tts.provider !== "openai" ? tts.model : "kokoro-en-v0_19";
    const dir = path.join(paseoHome(), "models", "local-speech", model);
    if (!fs.existsSync(path.join(dir, "model.onnx"))) {
      throw new Error(
        `Local TTS model '${model}' is not downloaded. Download it in Paseo Settings > Voice.`,
      );
    }
    const nodeRequire = createRequire(import.meta.url);
    const sherpa = nodeRequire("sherpa-onnx") as {
      createOfflineTts(config: unknown): SherpaOfflineTts;
    };
    return sherpa.createOfflineTts({
      offlineTtsModelConfig: {
        numThreads: 1,
        debug: false,
        offlineTtsKokoroModelConfig: {
          model: path.join(dir, "model.onnx"),
          voices: path.join(dir, "voices.bin"),
          tokens: path.join(dir, "tokens.txt"),
          dataDir: path.join(dir, "espeak-ng-data"),
          lengthScale: 1.0,
          lexicon: "",
          lang: "en",
        },
      },
    });
  })();
  return kokoroPromise;
}

/** Float32 samples in -1..1 to 16-bit little-endian PCM in a 44-byte WAV header, mono. */
function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const numChannels = 1;
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    const pcm = value < 0 ? value * 0x8000 : value * 0x7fff;
    buffer.writeInt16LE(Math.round(pcm), offset);
    offset += 2;
  }
  return buffer;
}

export default function contribute(server: PluginServerContext) {
  server.handle(synthesizeSpeech, async (input: RpcInput<typeof synthesizeSpeech>) => {
    const text = truncateForReadAloud(input.text);
    if (!text.trim()) {
      throw new Error("Nothing to read aloud");
    }
    const tts = readTtsConfig();
    if (tts.provider === "openai") {
      return synthesizeOpenAi(tts, text);
    }
    const kokoro = await getKokoro();
    const audio = kokoro.generate({
      text,
      sid: tts.speakerId ?? 0,
      speed: tts.speed ?? 1.0,
    });
    const wav = encodeWav(audio.samples, audio.sampleRate);
    return { base64: wav.toString("base64"), mimeType: "audio/wav" };
  });
  return () => {};
}
