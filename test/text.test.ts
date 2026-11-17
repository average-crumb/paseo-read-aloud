import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_SPOKEN_CHARS, toChunks, toSpeech } from "../shared/text.ts";

test("code blocks are announced, inline code is read", () => {
  assert.equal(toSpeech("Run this:\n```sh\nnpm ci\n```\nThen `paseo plugin add`."), "Run this:\n(code block)\nThen paseo plugin add.");
});

test("links read as their text, bare URLs as 'link', images dropped", () => {
  assert.equal(toSpeech("See [the docs](https://paseo.sh) or https://x.y/z ![pic](a.png)"), "See the docs or link");
});

test("Markdown marks go, but characters inside words stay", () => {
  assert.equal(toSpeech("**Bold**, _italic_, ~~gone~~ and *em*"), "Bold, italic, gone and em");
  assert.equal(toSpeech("Rename snake_case_name in C# where a > b and 2*3"), "Rename snake_case_name in C# where a > b and 2*3");
});

test("headings, blockquotes, bullets, rules and arrows", () => {
  assert.equal(toSpeech("## Title\n> quoted\n- one\n2. two\n---\nA -> B → C"), "Title\nquoted\none\ntwo\nA to B to C");
});

test("tables become comma-separated rows", () => {
  assert.equal(toSpeech("| a | b |\n|---|:-:|\n| 1 | 2 |"), "a, b\n1, 2");
});

test("emoji are dropped and length is capped", () => {
  assert.equal(toSpeech("Done ✅🎉"), "Done");
  assert.equal(toSpeech("a".repeat(MAX_SPOKEN_CHARS + 50)).length, MAX_SPOKEN_CHARS);
});

test("first chunk is short so speech starts fast; later chunks fill up", () => {
  const text = "Sure. " + "This sentence is here to fill the reply out a little bit more. ".repeat(6);
  const chunks = toChunks(text);
  assert.ok(chunks[0].length <= 50, `first chunk too long: ${chunks[0].length}`);
  for (const chunk of chunks.slice(1)) assert.ok(chunk.length <= 140, `chunk too long: ${chunk.length}`);
});

test("no text is lost, including words longer than a chunk", () => {
  const hash = "x".repeat(130);
  const text = `Commit ${hash} is in, then check index.server.ts and version 0.15.4 carefully, please.`;
  const joined = toChunks(text).join(" ").replace(/\s+/g, "");
  assert.equal(joined, text.replace(/\s+/g, ""));
});

test("long first sentence breaks at a comma when it can", () => {
  const chunks = toChunks("Here is the short version of the answer, followed by a much longer explanation of everything else.");
  assert.equal(chunks[0], "Here is the short version of the answer,");
});

test("chunks never cut inside a version number or file name", () => {
  for (const chunk of toChunks("Update to 0.15.4. Then edit index.server.ts and restart.")) {
    assert.ok(!/^\d|^ts\b/.test(chunk), `bad split: ${chunk}`);
  }
});

test("chunks without letters or digits are dropped", () => {
  assert.deepEqual(toChunks("... !!! ;"), []);
});
