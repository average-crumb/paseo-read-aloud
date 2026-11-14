import type { PluginServerContext } from "@getpaseo/plugin/server";
import { synthesizeSpeech, voiceStatus } from "./shared/speech";
import { addReadAloudRow } from "./server/reply-row";
import { checkVoice, synthesize } from "./server/tts";

export default function contribute(server: PluginServerContext) {
  server.handle(synthesizeSpeech, synthesize);
  server.handle(voiceStatus, checkVoice);
  return server.addHook("agent.turn.after", addReadAloudRow);
}
