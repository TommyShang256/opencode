import { Agent } from "@opencode-ai/core/agent"
import { Location } from "@opencode-ai/core/location"
import { Mcp } from "@opencode-ai/core/mcp/index"
import { Permission } from "@opencode-ai/core/permission"
import { Session } from "@opencode-ai/core/session"
import { McpTool } from "@opencode-ai/core/tool/mcp"
import { ShellContext } from "@opencode-ai/core/shell/context"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import {
  McpServerNotFoundError,
  PermissionDeniedError,
  ServiceUnavailableError,
  SessionNotFoundError,
} from "@opencode-ai/protocol/errors"
import { Cause, Effect, SynchronizedRef } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { HttpServerRequest } from "effect/unstable/http"
import { Api } from "../api"
import { response } from "../location"
import { pluginReadiness } from "./plugin-readiness"

const flushPlugins = pluginReadiness(
  () => new ServiceUnavailableError({ message: "MCP catalog initialization timed out", service: "mcp.catalog" }),
)

const allowedCallersMetaKey = "com.huawei.ryoma.dataagent/allowed-callers"

const notFound = <A, R>(effect: Effect.Effect<A, Mcp.NotFoundError, R>) =>
  effect.pipe(Effect.mapError((error) => new McpServerNotFoundError({ server: error.server, message: error.message })))

export const McpHandler = HttpApiBuilder.group(Api, "server.mcp", (handlers) =>
  Effect.gen(function* () {
    const bridgeSessions = yield* SynchronizedRef.make(new Map<string, Session.ID>())
    return handlers
      .handle(
        "mcp.bridge.context",
        Effect.fn(function* () {
          const scope = yield* readBridgeContext()
          if (!scope.toolContext) {
            return yield* new PermissionDeniedError({ message: "MCP_BRIDGE_CONTEXT_UNAVAILABLE", permission: "mcp.bridge" })
          }
          yield* assertBridgeLive(scope)
          return yield* response(Effect.succeed({
            sessionID: Session.ID.make(scope.toolContext.sessionID),
            messageID: scope.toolContext.messageID,
            executionID: scope.toolContext.executionID,
            agent: Agent.ID.make(scope.toolContext.agent),
          }))
        }),
      )
      .handle(
        "mcp.list",
        Effect.fn(function* () {
          const scope = yield* readBridgeContext()
          yield* flushPlugins
          const service = yield* Mcp.Service
          const servers = yield* service.servers()
          const visible = scope.reference === undefined ? undefined
            : new Set((yield* scopedCatalog(yield* service.tools(), scope)).map(tool => tool.server))
          return yield* response(Effect.succeed(servers.filter(info => visible === undefined || visible.has(info.name))
            .map(info => ({ name: info.name, status: info.status, integrationID: info.integrationID }))))
        }),
      )
      .handle(
        "mcp.add",
        Effect.fn(function* (ctx) {
          const service = yield* Mcp.Service
          yield* service.add(ctx.params.server, ctx.payload.config)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "mcp.remove",
        Effect.fn(function* (ctx) {
          const service = yield* Mcp.Service
          yield* notFound(service.remove(ctx.params.server))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "mcp.connect",
        Effect.fn(function* (ctx) {
          const service = yield* Mcp.Service
          yield* notFound(service.connect(ctx.params.server))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "mcp.disconnect",
        Effect.fn(function* (ctx) {
          const service = yield* Mcp.Service
          yield* notFound(service.disconnect(ctx.params.server))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "mcp.tools.list",
        Effect.fn(function* (ctx) {
          const scope = yield* readBridgeContext()
          yield* flushPlugins
          const service = yield* Mcp.Service
          const servers = yield* service.servers()
          if (!servers.some((server) => server.name === ctx.params.server)) {
            return yield* new McpServerNotFoundError({
              server: ctx.params.server,
              message: `MCP server not found: ${ctx.params.server}`,
            })
          }
          return yield* response(scopedCatalog((yield* service.tools()).filter(tool => tool.server === ctx.params.server), scope))
        }),
      )
      .handle(
        "mcp.tool.call",
        Effect.fn(function* (ctx) {
          const scope = yield* readBridgeContext()
          const toolContext = scope.toolContext
          if (toolContext && ((ctx.payload.sessionId !== undefined && ctx.payload.sessionId !== toolContext.sessionID)
            || (ctx.payload.agent !== undefined && ctx.payload.agent !== toolContext.agent))) {
            return yield* new PermissionDeniedError({ message: "MCP_BRIDGE_CONTEXT_MISMATCH", permission: "mcp.bridge" })
          }
          yield* flushPlugins
          const service = yield* Mcp.Service
          const permission = yield* Permission.Service
          const session = yield* Session.Service
          const location = yield* Location.Service
          const agents = yield* Agent.Service
          const tool = (yield* service.tools()).find(
            (candidate) => candidate.server === ctx.params.server && candidate.name === ctx.params.tool,
          )
          const declaredCallers = toolCallers(tool)

          // DataAgent publishes the caller contract with each tool. A bridge
          // request represents SCRIPT, so an explicit contract is authoritative
          // and must not inherit a model Agent's tool allowlist.
          if (declaredCallers && !declaredCallers.includes("script")) {
            return yield* new PermissionDeniedError({
              message: `MCP tool is not available to script callers: ${ctx.params.server}/${ctx.params.tool}`,
              permission: McpTool.name(ctx.params.server, ctx.params.tool),
            })
          }

          const action = McpTool.name(ctx.params.server, ctx.params.tool)
          const hooks = yield* PluginHooks.Service
          yield* hooks.trigger("mcp", "bridge.validate", {
            server: ctx.params.server, tool: ctx.params.tool, input: ctx.payload.arguments, toolContext,
          }).pipe(Effect.mapError(() => new PermissionDeniedError({ message: "MCP_BRIDGE_CALL_DENIED", permission: action })))

          // Agent state loads asynchronously at startup; permission rules resolve
          // via agents, and an unloaded registry fails CLOSED (deny-all). Wait
          // briefly for it so early bridge calls aren't spuriously denied.
          if (!declaredCallers) {
            for (let i = 0; i < 25; i++) {
              if ((yield* agents.list()).length > 0) break
              yield* Effect.sleep("200 millis")
            }
          }

          const locationRef = Location.Ref.make({
            directory: location.directory,
            workspaceID: location.workspaceID,
          })
          const sessionID =
            (toolContext ? Session.ID.make(toolContext.sessionID) : ctx.payload.sessionId) ??
            (yield* SynchronizedRef.modifyEffect(bridgeSessions, (sessions) => {
              const key = bridgeSessionKey(locationRef)
              const existing = sessions.get(key)
              if (existing) return Effect.succeed([existing, sessions] as const)
              return session.create({ location: locationRef }).pipe(
                Effect.map((created) => [created.id, new Map(sessions).set(key, created.id)] as const),
                Effect.mapError(
                  (error) =>
                    new SessionNotFoundError({
                      sessionID: error.sessionID,
                      message: `Failed to create bridge session: ${error.sessionID}`,
                    }),
                ),
              )
            }))

          // Keep this request alive while the standard permission endpoint resolves it,
          // so both "once" and "always" have the same meaning as an LLM-owned tool call.
          if (!declaredCallers) {
            yield* permission
              .assert({
                action,
                resources: ["*"],
                save: ["*"],
                metadata: { bridge: "mcp.tool.call" },
                sessionID,
                agent: toolContext ? Agent.ID.make(toolContext.agent) : ctx.payload.agent,
              })
              .pipe(
                Effect.mapError((error) =>
                  error._tag === "Session.NotFoundError"
                    ? new SessionNotFoundError({ sessionID: error.sessionID, message: error.message })
                    : new PermissionDeniedError({ message: error.message, permission: action }),
                ),
                Effect.catchCause((cause) =>
                  Cause.squash(cause) instanceof Permission.DeclinedError
                    ? Effect.fail(
                        new PermissionDeniedError({ message: `MCP tool call denied: ${action}`, permission: action }),
                      )
                    : Effect.failCause(cause),
                ),
              )
          }

          yield* assertBridgeLive(scope)
          const result = yield* service
            .callTool({
              server: ctx.params.server,
              name: ctx.params.tool,
              args: ctx.payload.arguments,
              ...(toolContext ? { sessionID: Session.ID.make(toolContext.sessionID) } : {}),
              ...(scope.reference ? { scriptContext: {
                reference: scope.reference, directory: location.directory,
                ...(location.workspaceID ? { workspace: location.workspaceID } : {}),
              } } : {}),
            })
            .pipe(
              Effect.catchTags({
                "MCP.NotFoundError": (error) =>
                  new McpServerNotFoundError({ server: error.server, message: error.message }),
                "MCP.ToolCallError": (error) =>
                  new ServiceUnavailableError({
                    service: `mcp:${error.server}`,
                    message: `MCP tool call failed (${error.server}/${error.tool}): ${error.message}`,
                  }),
              }),
            )
          return result
        }),
      )
      .handle(
        "mcp.resource.catalog",
        Effect.fn(function* () {
          const service = yield* Mcp.Service
          return yield* response(service.resourceCatalog())
        }),
      )
  }),
)

function bridgeSessionKey(location: Location.Ref) {
  return `${location.workspaceID ?? "local"}\u0000${location.directory}`
}

type BridgeScope = { reference: string | undefined; toolContext: ShellContext.Identity | undefined }

const readBridgeContext = Effect.fn(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const contexts = yield* ShellContext.Service
  const reference = request.headers["x-opencode-tool-context"]
  const toolContext = reference === undefined ? undefined : yield* contexts.resolve(reference)
  if (reference !== undefined && toolContext === undefined) {
    return yield* new PermissionDeniedError({ message: "MCP_BRIDGE_CONTEXT_UNAVAILABLE", permission: "mcp.bridge" })
  }
  if (toolContext) {
    const session = yield* Session.Service
    const location = yield* Location.Service
    const owner = yield* session.get(Session.ID.make(toolContext.sessionID)).pipe(
      Effect.mapError(() => new PermissionDeniedError({ message: "MCP_BRIDGE_CONTEXT_UNAVAILABLE", permission: "mcp.bridge" })),
    )
    if (owner.location.directory !== location.directory || owner.location.workspaceID !== location.workspaceID) {
      return yield* new PermissionDeniedError({ message: "MCP_BRIDGE_CONTEXT_MISMATCH", permission: "mcp.bridge" })
    }
  }
  return { reference, toolContext }
})

const assertBridgeLive = Effect.fn(function* (scope: BridgeScope) {
  if (scope.reference === undefined) return
  const contexts = yield* ShellContext.Service
  if ((yield* contexts.resolve(scope.reference)) !== scope.toolContext) {
    return yield* new PermissionDeniedError({ message: "MCP_BRIDGE_CONTEXT_UNAVAILABLE", permission: "mcp.bridge" })
  }
})

const scopedCatalog = Effect.fn(function* (tools: Mcp.Tool[], scope: BridgeScope) {
  if (scope.reference === undefined) return tools // Explicit administrative inventory, not a script permission grant.
  const candidates = tools.filter(tool => toolCallers(tool)?.includes("script") ?? true)
  const hooks = yield* PluginHooks.Service
  const event = yield* hooks.trigger("mcp", "bridge.catalog", {
    toolContext: scope.toolContext, tools: candidates.map(tool => ({ server: String(tool.server), name: tool.name })),
  }).pipe(Effect.mapError(() => new PermissionDeniedError({ message: "MCP_BRIDGE_CALL_DENIED", permission: "mcp.bridge" })))
  yield* assertBridgeLive(scope)
  const visible = new Set(event.tools.map(tool => JSON.stringify([tool.server, tool.name])))
  return candidates.filter(tool => visible.has(JSON.stringify([tool.server, tool.name])))
})

function toolCallers(tool: Mcp.Tool | undefined) {
  const value = tool?.meta?.[allowedCallersMetaKey]
  return Array.isArray(value) && value.every((caller): caller is string => typeof caller === "string") ? value : undefined
}
