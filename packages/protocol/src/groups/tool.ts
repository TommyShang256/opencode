import { Tool } from "@opencode-ai/schema/tool"
import { Location } from "@opencode-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const ToolGroup = HttpApiGroup.make("server.tool")
  .add(
    HttpApiEndpoint.get("tool.list", "/api/tool", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Tool.Definition)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.tool.list",
          summary: "List tools",
          description:
            "Retrieve every currently registered tool (built-in, plugin-injected, and MCP-aggregated) without permission filtering or CodeMode aggregation.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "tool",
      description: "Tool registry inventory routes.",
    }),
  )
