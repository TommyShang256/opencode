import { Tool } from "@opencode-ai/core/tool"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const ToolHandler = HttpApiBuilder.group(Api, "server.tool", (handlers) =>
  handlers.handle("tool.list", () => response(Tool.Service.use((tool) => tool.list()))),
)
