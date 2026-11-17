import type { PluginServerContext } from "@getpaseo/plugin/server";
import { cancelSpeech, synthesizeSpeech, voiceStatus } from "./shared/speech";
import { addReadAloudRow } from "./server/reply-row";
import { cancel, checkVoice, disposeEngine, synthesize } from "./server/tts";

export default function contribute(server: PluginServerContext) {
  server.handle(synthesizeSpeech, synthesize);
  server.handle(cancelSpeech, cancel);
  server.handle(voiceStatus, checkVoice);
  const removeHook = server.addHook("agent.turn.after", addReadAloudRow);
  return async () => {
    if (typeof removeHook === "function") await removeHook();
    disposeEngine();
  };
}
