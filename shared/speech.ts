import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Maximum number of characters spoken per press. */
export const READ_ALOUD_MAX_CHARS = 4000;

/** Caps text at READ_ALOUD_MAX_CHARS, marking it with a trailing "…" only when it was actually truncated. */
export function truncateForReadAloud(text: string): string {
  return text.length > READ_ALOUD_MAX_CHARS ? text.slice(0, READ_ALOUD_MAX_CHARS) + "…" : text;
}

export const synthesizeSpeech = defineRpc({
  name: "speech.synthesize",
  input: z.object({ text: z.string() }),
  output: z.object({ base64: z.string(), mimeType: z.string() }),
});
