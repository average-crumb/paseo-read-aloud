import type { PluginClientContext } from "@getpaseo/plugin/client";
import { createReadAloudRow } from "./client/read-aloud-row";
import { READ_ALOUD_KIND, readAloudSchema } from "./shared/speech";

export default function contribute(client: PluginClientContext) {
  return client.addTimelineRenderer({
    kind: READ_ALOUD_KIND,
    version: 1,
    schema: readAloudSchema,
    Component: createReadAloudRow(client),
  });
}
