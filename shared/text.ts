/**
 * Pure text helpers for turning a reply into speech. No imports, so they run (and are tested)
 * without Paseo or any packages installed.
 */

/** Longest reply read per press (about 20 minutes of speech). */
export const MAX_SPOKEN_CHARS = 20_000;

/**
 * Turns Markdown into speakable text: drops code blocks, links, emoji and formatting marks, but
 * keeps characters that are part of the words themselves (snake_case, C#, a > b).
 */
export function toSpeech(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, "\n(code block)\n")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*(?:>\s?)+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    // Table divider rows (|---|:-:|), with or without outer pipes and with any number of dashes.
    .replace(/^\s*(?:\|\s*:?-+:?\s*)+\|?\s*$|^\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/gm, "")
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "")
    .replace(/^[ \t]*\|[ \t]*|[ \t]*\|[ \t]*$/gm, "")
    .replace(/[ \t]*\|[ \t]*/g, ", ")
    .replace(/\s*(?:->|=>|[→⇒])\s*/g, " to ")
    .replace(/[←↔]/g, " ")
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    // Emphasis marks: paired ** __ ~~, and a single * or _ only where it opens or closes a word,
    // so snake_case and 2*3 survive.
    .replace(/(\*\*|__|~~)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/~~/g, "")
    .replace(/(?<![\p{L}\p{N}])[*_](?=\S)|(?<=\S)[*_](?![\p{L}\p{N}])/gu, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, MAX_SPOKEN_CHARS);
}

/** Sentences, each keeping its closing punctuation and trailing quote or bracket. */
function sentences(text: string): string[] {
  const raw = text.match(/[^.!?;\n]+[.!?;]*["')\]]*\s*|\n/g) ?? [text];
  // A stop with no space after it is inside a word or number (0.15.4, index.ts): rejoin.
  const merged: string[] = [];
  for (const piece of raw) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && previous !== "\n" && piece !== "\n" && !/\s$/.test(previous)) {
      merged[merged.length - 1] = previous + piece;
    } else {
      merged.push(piece);
    }
  }
  return merged;
}

/** Breaks an over-long sentence at clause marks first, then at spaces, then mid-word. */
function splitLong(sentence: string, size: number): string[] {
  const parts: string[] = [];
  let current = "";
  for (let token of sentence.match(/\S+\s*/g) ?? []) {
    // A single word longer than a chunk (a path, a hash): cut it, never drop it.
    while (token.length > size) {
      if (current) parts.push(current);
      current = "";
      parts.push(token.slice(0, size));
      token = token.slice(size);
    }
    if (current && (current + token).length > size) {
      // Prefer ending at the last clause mark, if that still leaves a reasonably long part.
      const clause = /^([\s\S]*[,:;–—)]\s+)([\s\S]*)$/.exec(current);
      if (clause && clause[1].length >= size * 0.4) {
        parts.push(clause[1]);
        current = clause[2];
      } else {
        parts.push(current);
        current = "";
      }
      if (current && (current + token).length > size) {
        parts.push(current);
        current = "";
      }
    }
    current += token;
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Splits text into short chunks so Stop takes effect quickly: Paseo plays clips through a queue
 * that cannot be interrupted mid-clip. The first chunk is kept especially short, and broken at a
 * comma when it can be, so speech starts as soon as possible; later chunks are prepared while
 * earlier ones play.
 */
export function toChunks(text: string, maxSize = 140, firstSize = 50): string[] {
  const chunks: string[] = [];
  let current = "";
  const limit = () => (chunks.length ? maxSize : firstSize);
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const sentence of sentences(text)) {
    if (current && (current + sentence).length > limit()) flush();
    if (sentence.length <= limit()) {
      current += sentence;
      continue;
    }
    for (const part of splitLong(sentence, limit())) {
      if (current && (current + part).length > limit()) flush();
      current += part;
      if (current.length >= limit()) flush();
    }
  }
  flush();
  return chunks.filter((chunk) => /[\p{L}\p{N}]/u.test(chunk));
}
