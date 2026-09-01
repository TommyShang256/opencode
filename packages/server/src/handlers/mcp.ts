import { Agent } from "@opencode/core/agent"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { McpTool } from "@opencode/core/tool/mcp"
import {
  McpServerNotFoundError,
  PermissionDeniedError,
  ServiceUnavailableError,
  SessionNotFoundError,
} from "@opencode/protocol/errors"
import { Cause, Effect, SynchronizedRef } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

const notFound = <A, R>(effect: Effect.Effect<A, Mcp.NotFoundError, R>) =>
  effect.pipe(Effect.mapError((error) => new McpServerNotFoundError({ server: error.server, message: error.message })))

export const McpHandler = HttpApiBuilder.group(Api, "server.mcp", (handlers) =>
  Effect.gen(function* () {
    const bridgeSessions = yield* SynchronizedRef.make(new Map<string, Session.ID>())
    return handlers
      .handle(
        "mcp.list",
        Effect.fn(function* () {
          const service = yield* Mcp.Service
          return yield* response(
            service
              .servers()
              .pipe(
                Effect.map((servers) =>
                  servers.map((info) => ({ name: info.name, status: info.status, integrationID: info.integrationID })),
                ),
              ),
          )
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
          const service = yield* Mcp.Service
          const servers = yield* service.servers()
          if (!servers.some((server) => server.name === ctx.params.server)) {
            return yield* new McpServerNotFoundError({
              server: ctx.params.server,
              message: `MCP server not found: ${ctx.params.server}`,
            })
          }
          return yield* response(
            service.tools().pipe(Effect.map((tools) => tools.filter((tool) => tool.server === ctx.params.server))),
          )
        }),
      )
      .handle(
        "mcp.tool.call",
        Effect.fn(function* (ctx) {
          const service = yield* Mcp.Service
          const permission = yield* Permission.Service
          const session = yield* Session.Service
          const location = yield* Location.Service
          const agents = yield* Agent.Service

          // Agent state loads asynchronously at startup; permission rules resolve
          // via agents, and an unloaded registry fails CLOSED (deny-all). Wait
          // briefly for it so early bridge calls aren't spuriously denied.
          for (let i = 0; i < 25; i++) {
            if ((yield* agents.list()).length > 0) break
            yield* Effect.sleep("200 millis")
          }

          const locationRef = Location.Ref.make({
            directory: location.directory,
            workspaceID: location.workspaceID,
          })
          const sessionID =
            ctx.payload.sessionId ??
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
          const action = McpTool.name(ctx.params.server, ctx.params.tool)
          yield* permission
            .assert({
              action,
              resources: ["*"],
              save: ["*"],
              metadata: { bridge: "mcp.tool.call" },
              sessionID,
              agent: ctx.payload.agent,
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

          const result = yield* service
            .callTool({
              server: ctx.params.server,
              name: ctx.params.tool,
              args: ctx.payload.arguments,
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
