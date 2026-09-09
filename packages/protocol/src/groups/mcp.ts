import { Mcp } from "@opencode-ai/schema/mcp"
import { Agent } from "@opencode-ai/schema/agent"
import { Location } from "@opencode-ai/schema/location"
import { Session } from "@opencode-ai/schema/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import {
  McpServerNotFoundError,
  PermissionDeniedError,
  ServiceUnavailableError,
  SessionNotFoundError,
} from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const McpGroup = HttpApiGroup.make("server.mcp")
  .add(
    HttpApiEndpoint.get("mcp.bridge.context", "/api/mcp/bridge/context", {
      query: LocationQuery,
      success: Location.response(Schema.Struct({
        sessionID: Session.ID,
        messageID: Schema.String,
        executionID: Schema.String,
        agent: Agent.ID,
      })),
      error: PermissionDeniedError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({
        identifier: "v2.mcp.bridge.context",
        summary: "Resolve a live native shell context",
        description: "Requires x-opencode-tool-context and the owning Location. Returns execution identity, not tool authorization or a durable lease.",
      })),
  )
  .add(
    HttpApiEndpoint.get("mcp.list", "/api/mcp", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Mcp.Server)),
      error: [ServiceUnavailableError, PermissionDeniedError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.mcp.list",
          summary: "List MCP servers",
          description: "Retrieve configured MCP servers and their connection status.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("mcp.add", "/api/mcp/:server", {
      params: { server: Schema.String },
      query: LocationQuery,
      // Wrapped in a struct because the client codegen flattens payload fields and cannot
      // represent a top-level union payload.
      payload: Schema.Struct({ config: Mcp.ServerConfig }),
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.mcp.add",
          summary: "Add MCP server",
          description: "Add an MCP server at runtime or replace an existing one, connecting it immediately.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("mcp.remove", "/api/mcp/:server", {
      params: { server: Schema.String },
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
      error: McpServerNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.mcp.remove",
          summary: "Remove MCP server",
          description: "Stop an MCP server and remove it from the runtime set until restart.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("mcp.connect", "/api/mcp/:server/connect", {
      params: { server: Schema.String },
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
      error: McpServerNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.mcp.connect",
          summary: "Connect MCP server",
          description: "Connect an MCP server at runtime, overriding a disabled configuration until restart.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("mcp.disconnect", "/api/mcp/:server/disconnect", {
      params: { server: Schema.String },
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
      error: McpServerNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.mcp.disconnect",
          summary: "Disconnect MCP server",
          description: "Disconnect an MCP server at runtime, removing its tools until reconnected.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("mcp.resource.catalog", "/api/mcp/resource", {
      query: LocationQuery,
      success: Location.response(Mcp.ResourceCatalog),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.mcp.resource.catalog",
          summary: "List MCP resources",
          description: "Retrieve resources and resource templates from connected MCP servers.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("mcp.tools.list", "/api/mcp/:server/tools", {
      params: { server: Schema.String },
      query: LocationQuery,
      success: Location.response(Schema.Array(Mcp.ToolInfo)),
      error: [McpServerNotFoundError, ServiceUnavailableError, PermissionDeniedError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.mcp.tools.list",
          summary: "List MCP tools",
          description: "List the tools exposed by one configured MCP server.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("mcp.tool.call", "/api/mcp/:server/tool/:tool/call", {
      params: { server: Schema.String, tool: Schema.String },
      query: LocationQuery,
      payload: Schema.Struct({
        arguments: Schema.Record(Schema.String, Schema.Unknown),
        sessionId: Session.ID.pipe(Schema.optional),
        agent: Agent.ID.pipe(Schema.optional),
      }),
      success: Mcp.ToolCallResult,
      error: [McpServerNotFoundError, PermissionDeniedError, ServiceUnavailableError, SessionNotFoundError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.mcp.tool.call",
          summary: "Call MCP tool",
          description:
            "Invoke a tool on a connected MCP server (Tool Bridge). Subject to the same permission rules as LLM-invoked MCP tools.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "mcp", description: "MCP server and resource routes." }))
