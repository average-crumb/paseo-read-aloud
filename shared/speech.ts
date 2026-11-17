import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export { MAX_SPOKEN_CHARS, toChunks, toSpeech } from "./text";

/**
 * Renders one chunk of speakable text to an audio file with Paseo's configured voice.
 * `session` groups the chunks of one press so a stop can drop the ones still waiting.
 * `durationMs` is set when the length is known exactly (local voices), for gapless playback.
 */
export const synthesizeSpeech = defineRpc({
  name: "speech.synthesize",
  input: z.object({ text: z.string().min(1).max(2000), session: z.string().max(100).optional() }),
  output: z.object({ base64: z.string(), mimeType: z.string(), durationMs: z.number().optional() }),
});

/** Drops a session's queued chunks and aborts its in-flight network requests. */
export const cancelSpeech = defineRpc({
  name: "speech.cancel",
  input: z.object({ session: z.string().max(100) }),
  output: z.object({ ok: z.boolean() }),
});

/** Whether the voice Paseo would use can speak right now, with fix-up steps when it can't. */
export const voiceStatus = defineRpc({
  name: "speech.status",
  input: z.object({}),
  output: z.object({
    ok: z.boolean(),
    voice: z.string(),
    provider: z.enum(["local", "openai", "unknown"]).optional(),
    problem: z.string().optional(),
    steps: z.array(z.string()).optional(),
  }),
});
export type VoiceStatus = z.output<typeof voiceStatus.output>;

/** Timeline row added under each finished reply. */
export const READ_ALOUD_KIND = "read-aloud";
export const readAloudSchema = z.object({ text: z.string() });
