import { expect } from "bun:test"
import { Effect, Exit, Layer, Scope } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { ShellContext } from "@opencode-ai/core/shell/context"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { Mcp } from "@opencode-ai/core/mcp/index"
import { Tool } from "@opencode-ai/schema/tool"
import { it } from "../../core/test/lib/effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { ServerFetch } from "../src/fetch"

it.live("binds MCP bridge calls to issued scope and applies final policy before side effects", () =>
  Effect.gen(function* () {
    const contexts = yield* ShellContext.Service
    const hooks = yield* PluginHooks.Service
    const invoked: { name: string; sessionID?: string }[] = []
    const mcp = Layer.mock(Mcp.Service, {
      tools: () => Effect.succeed(["lookup", "private"].map(name => new Mcp.Tool({
        server: Mcp.ServerName.make("catalog"), name,
        meta: { "com.huawei.ryoma.dataagent/allowed-callers": ["script"] },
      }))),
      callTool: input => {
        invoked.push({ name: input.name, sessionID: input.sessionID })
        return Effect.succeed({ server: input.server, tool: input.name, isError: false, content: [] })
      },
    })
    yield* hooks.register("mcp", "bridge.validate", event => {
      if (!event.toolContext || event.tool === "private") return Effect.fail(new Tool.Error({ message: "fixture-private-detail" }))
      // Validators receive detached views; rewriting the event must not redirect execution.
      Object.assign(event, { tool: "private" })
      return Effect.void
    })
    const handler = yield* ServerFetch.make({
      app: { version: "test" }, database: { path: ":memory:" },
      config: { project: false }, models: { fetch: false }, fs: { filewatcher: false },
    }, { overrides: [
      Mcp.node.replace(mcp), ShellContext.node.replace(Layer.succeed(ShellContext.Service, contexts)),
      PluginHooks.node.replace(Layer.succeed(PluginHooks.Service, hooks)),
    ] })
    const created = yield* Effect.promise(() => handler(new Request("http://opencode.local/api/session", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    })).then(response => response.json()))
    const identity = { sessionID: created.data.id as string, messageID: "msg_bridge", executionID: "call_shell", agent: "build" }
    const scope = yield* Scope.make()
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
    const reference = yield* contexts.acquire(identity).pipe(Scope.provide(scope))
    const call = (tool = "lookup", body: Record<string, unknown> = {}, scoped = true, directory?: string) => Effect.promise(() => handler(new Request(
      `http://opencode.local/api/mcp/catalog/tool/${tool}/call`, {
        method: "POST", headers: { "content-type": "application/json", ...(scoped ? { "x-opencode-tool-context": reference } : {}),
          ...(directory ? { "x-opencode-directory": encodeURIComponent(directory) } : {}) },
        body: JSON.stringify({ arguments: {}, ...body }),
      },
    )))
    expect((yield* call()).status).toBe(200)
    expect(invoked).toEqual([{ name: "lookup", sessionID: identity.sessionID }])
    const foreign = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("bridge-foreign-location-")))
    expect((yield* call("lookup", {}, true, foreign.path)).status).toBe(403)
    for (const body of [{ sessionId: "ses_other" }, { agent: "other" }]) {
      const denied = yield* call("lookup", body)
      expect(denied.status).toBe(403)
      expect(yield* Effect.promise(() => denied.text())).toContain("MCP_BRIDGE_CONTEXT_MISMATCH")
    }
    const privateCall = yield* call("private")
    const privateError = yield* Effect.promise(() => privateCall.text())
    expect(privateCall.status).toBe(403)
    expect(privateError).toContain("MCP_BRIDGE_CALL_DENIED")
    expect(privateError).not.toContain("fixture-private-detail")
    expect((yield* call("lookup", {}, false)).status).toBe(403)
    // Expiry during validation must still stop the subsequent remote side effect.
    yield* hooks.register("mcp", "bridge.validate", () => Scope.close(scope, Exit.void))
    const stale = yield* call()
    expect(stale.status).toBe(403)
    expect(yield* Effect.promise(() => stale.text())).toContain("MCP_BRIDGE_CONTEXT_UNAVAILABLE")
    expect((yield* call()).status).toBe(403)
    expect(invoked).toHaveLength(1)
  }).pipe(Effect.provide(AppNodeBuilder.build(LayerNode.group([ShellContext.node, PluginHooks.node]))), Effect.scoped),
)
