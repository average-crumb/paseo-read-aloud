import type { PluginClientContext, PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { z } from "zod";
import { readAloudSchema, synthesizeSpeech, toChunks, toSpeech, voiceStatus, type VoiceStatus } from "../shared/speech";

type Props = PluginTimelineItemProps<z.output<typeof readAloudSchema>>;
type State = "idle" | "loading" | "playing";
type AudioData = z.output<typeof synthesizeSpeech.output>;


/** Only one reply reads at a time; starting another stops the current one. */
let activeStop: (() => void) | null = null;

/**
 * One voice check shared by every row, refreshed at most every 15 seconds, so a long chat does
 * not send a request per reply. Rows subscribe and all update together.
 */
const STATUS_TTL_MS = 15_000;
let status: { value: VoiceStatus | null; checkedAt: number; pending: Promise<void> | null } = {
  value: null,
  checkedAt: 0,
  pending: null,
};
const listeners = new Set<(value: VoiceStatus) => void>();

function publish(value: VoiceStatus) {
  status = { value, checkedAt: Date.now(), pending: null };
  for (const listener of listeners) listener(value);
}

function refreshStatus(client: PluginClientContext, force = false): Promise<void> {
  if (status.pending) return status.pending;
  if (!force && status.value && Date.now() - status.checkedAt < STATUS_TTL_MS) return Promise.resolve();
  const pending = client
    .rpc(voiceStatus, {})
    .then(publish)
    .catch(() => {
      // The plugin is restarting or the host is offline; keep showing the last known state.
      status = { ...status, pending: null };
    });
  status = { ...status, pending };
  return pending;
}

function useVoiceStatus(client: PluginClientContext): VoiceStatus | null {
  const [value, setValue] = useState<VoiceStatus | null>(status.value);
  useEffect(() => {
    listeners.add(setValue);
    void refreshStatus(client);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}

export function createReadAloudRow(client: PluginClientContext) {
  return function ReadAloudRow({ item, theme }: Props) {
    const [state, setState] = useState<State>("idle");
    const [hovered, setHovered] = useState(false);
    const [pinned, setPinned] = useState(false);
    const voice = useVoiceStatus(client);
    const stopped = useRef(true);
    const warm = useRef<Promise<AudioData | null> | null>(null);
    const toast = useToast();
    useEffect(() => () => {
      stopped.current = true;
    }, []);

    async function play() {
      activeStop?.();
      stopped.current = false;
      const stop = () => {
        stopped.current = true;
        setState("idle");
      };
      activeStop = stop;
      const chunks = toChunks(toSpeech(item.data.text));
      const speak = (text: string) => client.rpc(synthesizeSpeech, { text });
      // Reuse the first chunk prepared while the pointer hovered over the button.
      const cached = warm.current;
      warm.current = null;
      setState("loading");
      try {
        // Prepare the next sentence while the current one plays.
        let next: Promise<AudioData> | null;
        if (cached) next = cached.then((audio) => audio ?? speak(chunks[0]));
        else next = chunks.length ? speak(chunks[0]) : null;
        for (let index = 0; index < chunks.length && next; index++) {
          const audio = await next;
          if (stopped.current) break;
          next = index + 1 < chunks.length ? speak(chunks[index + 1]) : null;
          next?.catch(() => undefined);
          setState("playing");
          await client.playAudio(audio).catch(() => {
            // Paseo's voice controls or a plugin reload interrupted playback.
            stopped.current = true;
          });
          if (stopped.current) break;
        }
      } catch (error) {
        if (!stopped.current) {
          // Show the warning with fix-up steps if the voice is the problem; otherwise a toast.
          await refreshStatus(client, true);
          if (status.value?.ok !== false) toast.error(error instanceof Error ? error.message : "Read aloud failed");
          else setPinned(true);
        }
      } finally {
        if (activeStop === stop) activeStop = null;
        stopped.current = true;
        setState("idle");
      }
    }

    const broken = voice?.ok === false;
    const busy = state !== "idle";
    const showHelp = broken && (pinned || hovered);
    const muted = theme.colors.foregroundMuted;

    return (
      <View style={{ flexDirection: "column", alignItems: "flex-start" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={broken ? "Read aloud unavailable. Show how to fix it" : busy ? "Stop reading" : "Read aloud"}
          hitSlop={8}
          onPress={() => {
            if (broken) {
              setPinned((open) => !open);
              void refreshStatus(client, true);
            } else if (busy) activeStop?.();
            else void play();
          }}
          onHoverIn={() => {
            setHovered(true);
            // Synthesize the first chunk in the background so the first press speaks at once.
            if (!warm.current && state === "idle" && !broken) {
              const first = toChunks(toSpeech(item.data.text))[0];
              if (first) warm.current = client.rpc(synthesizeSpeech, { text: first }).catch(() => null);
            }
          }}
          onHoverOut={() => setHovered(false)}
          style={({ pressed }) => ({
            paddingHorizontal: 8,
            paddingVertical: 4,
            marginHorizontal: -8,
            borderRadius: 8,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Icon
            name={broken ? "TriangleAlert" : state === "loading" ? "LoaderCircle" : state === "playing" ? "Square" : "Volume2"}
            size={14}
            color={broken ? theme.colors.statusDanger : busy || hovered ? theme.colors.foreground : muted}
          />
        </Pressable>
        {showHelp && voice ? (
          <View
            style={{
              marginTop: 4,
              maxWidth: 360,
              padding: 10,
              gap: 6,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.colors.statusDanger,
              backgroundColor: theme.colors.surface1,
            }}
          >
            <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>Read aloud can't speak yet</Text>
            {voice.problem ? <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>{voice.problem}</Text> : null}
            {(voice.steps ?? []).map((step, index) => (
              <Text key={index} style={{ color: muted, fontSize: 12 }}>
                {index + 1}. {step}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    );
  };
}
