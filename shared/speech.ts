import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Renders one chunk of speakable text to an audio file with Paseo's configured voice. */
export const synthesizeSpeech = defineRpc({
  name: "speech.synthesize",
  input: z.object({ text: z.string().min(1).max(2000) }),
  output: z.object({ base64: z.string(), mimeType: z.string() }),
});

/** Whether the voice Paseo would use can speak right now, with fix-up steps when it can't. */
export const voiceStatus = defineRpc({
  name: "speech.status",
  input: z.object({}),
  output: z.object({
    ok: z.boolean(),
    voice: z.string(),
    problem: z.string().optional(),
    steps: z.array(z.string()).optional(),
  }),
});
export type VoiceStatus = z.output<typeof voiceStatus.output>;

/** Timeline row added under each finished reply. */
export const READ_ALOUD_KIND = "read-aloud";
export const readAloudSchema = z.object({ text: z.string() });

/** Longest reply read per press (about 20 minutes of speech). */
export const MAX_SPOKEN_CHARS = 20_000;

/** Turns Markdown into speakable text: drops code blocks, links, emoji and formatting marks. */
export function toSpeech(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, "\n(code block)\n")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, "")
    .replace(/^[ \t]*\|[ \t]*|[ \t]*\|[ \t]*$/gm, "")
    .replace(/[ \t]*\|[ \t]*/g, ", ")
    .replace(/[→⇒]/g, " to ")
    .replace(/[←↔]/g, " ")
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/(\*\*|__|~~|[*_>#])/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, MAX_SPOKEN_CHARS);
}

/**
 * Splits text into short chunks so Stop takes effect quickly. Paseo's playback queues audio and
 * cannot interrupt a clip mid-play, so each chunk must stay short (about 10-12 characters per
 * second of speech). The first chunk is kept especially short so speech starts quickly; later
 * chunks are prepared while earlier ones play.
 */
export function toChunks(text: string, maxSize = 150, firstSize = 70): string[] {
  const sentences = text.match(/[^.!?;\n]+[.!?;]*["')\]]*\s*|\n/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const sentence of sentences) {
    const size = chunks.length ? maxSize : firstSize;
    if (current && (current + sentence).length > size) flush();
    if (sentence.length <= size) {
      current += sentence;
      continue;
    }
    // A very long sentence: break it at word boundaries.
    for (const word of sentence.split(/(\s+)/)) {
      if (current && (current + word).length > (chunks.length ? maxSize : firstSize)) flush();
      current += word.slice(0, size);
    }
  }
  flush();
  return chunks.filter((chunk) => /[\p{L}\p{N}]/u.test(chunk));
}
