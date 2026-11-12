import type { PluginClientContext, PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { StreamedText, useToast } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { z } from "zod";
import { synthesizeSpeech, truncateForReadAloud } from "./shared/speech";

const dataSchema = z.object({
  text: z.string(),
  phase: z.enum(["streaming", "complete"]),
});

export default function contribute(client: PluginClientContext) {
  function ReadAloudRow(props: PluginTimelineItemProps<z.infer<typeof dataSchema>>) {
    const { item, theme } = props;
    const { text, phase } = item.data;
    const [busy, setBusy] = useState(false);
    const synthesize = useRpc(synthesizeSpeech);
    const toast = useToast();

    const styles = useMemo(
      () => ({
        row: {
          flexDirection: "row" as const,
          alignItems: "flex-start" as const,
          gap: 8,
        },
        text: { flex: 1 },
        button: {
          padding: 4,
          borderRadius: 6,
          opacity: busy ? 0.5 : 1,
        },
        glyph: {
          fontSize: 14,
          color: theme.colors.foregroundMuted,
        },
      }),
      [busy, theme.colors.foregroundMuted],
    );

    const handlePress = async () => {
      if (busy) return;
      setBusy(true);
      try {
        const audio = await synthesize({ text: truncateForReadAloud(text) });
        await client.playAudio({ base64: audio.base64, mimeType: audio.mimeType });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Read-aloud failed");
      } finally {
        setBusy(false);
      }
    };

    return (
      <View style={styles.row}>
        <View style={styles.text}>
          <StreamedText text={text} phase={phase} />
        </View>
        {phase === "complete" && text.trim() !== "" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Read aloud"
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            style={styles.button}
            onPress={() => {
              void handlePress();
            }}
          >
            <Text style={styles.glyph}>{busy ? "⏳" : "🔊"}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  client.addTimelineTransformer({
    id: "read-aloud",
    query: { itemType: "assistant_message" },
    transform({ item, phase }) {
      if (item.text.trim() === "") return undefined;
      return {
        items: [
          {
            type: "plugin",
            kind: "read-aloud",
            version: 1,
            data: { text: item.text, phase },
          },
        ],
      };
    },
  });

  client.addTimelineRenderer({
    kind: "read-aloud",
    version: 1,
    schema: dataSchema,
    Component: ReadAloudRow,
  });

  return () => {};
}
