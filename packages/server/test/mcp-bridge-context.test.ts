import { expect } from "bun:test"
import { Effect, Exit, Layer, Scope } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { ShellContext } from "@opencode/core/shell/context"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Mcp } from "@opencode/core/mcp/index"
import { Tool } from "@opencode/schema/tool"
import { it } from "../../core/test/lib/effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { ServerFetch } from "../src/fetch"
import { McpSocket } from "../src/mcp-socket"
import { request } from "node:http"
import { stat } from "node:fs/promises"

it.live("binds MCP bridge calls to issued scope and applies final policy before side effects", () =>
  Effect.gen(function* () {
    const contexts = yield* ShellContext.Service
    const hooks = yield* PluginHooks.Service
    const invoked: Array<Parameters<Mcp.Interface["callTool"]>[0]> = []
    const mcp = Layer.mock(Mcp.Service, {
        awaitStartup: () => Effect.void,
      servers: () => Effect.succeed(["catalog", "empty"].map(name => ({ name: Mcp.ServerName.make(name), status: { status: "connected" } }))),
      tools: () => Effect.succeed(["lookup", "private", "model-only"].map(name => new Mcp.Tool({
        server: Mcp.ServerName.make("catalog"), name,
        meta: { "fixture/callers": [name === "model-only" ? "agent" : "script"] },
      }))),
      callTool: input => {
        invoked.push(input)
        return Effect.succeed({ server: input.server, tool: input.name, isError: false, content: [] })
      },
    })
    const authorize = yield* hooks.register("mcp", "bridge.authorize", event => Effect.sync(() => {
      event.decision = event.meta?.["fixture/callers"] instanceof Array
        && event.meta["fixture/callers"].includes("script") ? "allow" : "deny"
      // Authorization cannot change the target or arguments sent to the provider.
      Object.assign(event, { tool: "private", input: { forged: true } })
    }))
    yield* hooks.register("mcp", "bridge.validate", event => {
      if (!event.toolContext || event.tool === "private") return Effect.fail(new Tool.Error({ message: "fixture-private-detail" }))
      // Validators receive detached views; rewriting the event must not redirect execution.
      Object.assign(event, { tool: "private" })
      return Effect.void
    })
    const handler = yield* ServerFetch.make({
      app: { version: "test" }, database: { path: ":memory:" },
      config: { project: false, content: JSON.stringify({ permissions: [{ action: "*", resource: "*", effect: "deny" }] }) }, models: { fetch: false }, fs: { filewatcher: false },
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
    yield* hooks.register("mcp", "bridge.catalog", event => Effect.sync(() => {
      event.tools = event.tools.filter(tool => tool.name === "lookup")
    }))
    yield* hooks.register("mcp", "bridge.catalog", event => Effect.sync(() => {
      // A later plugin cannot restore tools removed by an earlier workbench policy.
      event.tools.push({ server: "catalog", name: "private" }, { server: "catalog", name: "model-only" })
    }))
    const catalog = (route: string, scoped = true) => Effect.promise(() => handler(new Request(
      `http://opencode.local${route}`, { headers: scoped ? { "x-opencode-tool-context": reference } : {} },
    )))
    const resolved = yield* catalog("/api/mcp/bridge/context")
    expect(resolved.status).toBe(200)
    const resolvedBody = yield* Effect.promise(() => resolved.json())
    expect(resolvedBody.data).toEqual(identity)
    expect(JSON.stringify(resolvedBody)).not.toContain(reference)
    expect((yield* catalog("/api/mcp/bridge/context", false)).status).toBe(403)
    const listed = yield* catalog("/api/mcp/catalog/tools")
    expect(listed.status).toBe(200)
    expect((yield* Effect.promise(() => listed.json())).data.map((tool: { name: string }) => tool.name)).toEqual(["lookup"])
    const servers = yield* catalog("/api/mcp")
    expect((yield* Effect.promise(() => servers.json())).data.map((server: { name: string }) => server.name)).toEqual(["catalog"])
    const global = yield* catalog("/api/mcp/catalog/tools", false)
    expect((yield* Effect.promise(() => global.json())).data).toHaveLength(3)
    const call = (tool = "lookup", body: Record<string, unknown> = {}, scoped = true, directory?: string) => Effect.promise(() => handler(new Request(
      `http://opencode.local/api/mcp/catalog/tool/${tool}/call`, {
        method: "POST", headers: { "content-type": "application/json", ...(scoped ? { "x-opencode-tool-context": reference } : {}),
          ...(directory ? { "x-opencode-directory": encodeURIComponent(directory) } : {}) },
        body: JSON.stringify({ arguments: {}, ...body }),
      },
    )))
    expect((yield* call()).status).toBe(200)
    expect(invoked).toEqual([{ server: "catalog", name: "lookup", args: {}, sessionID: identity.sessionID,
      scriptContext: { reference, directory: expect.any(String) },
    }])
    yield* McpSocket.install(contexts, handler)
    const connection = yield* contexts.connect(reference, { directory: invoked[0]!.scriptContext!.directory })
      .pipe(Scope.provide(scope))
    expect(connection).toBeDefined()
    const socketRequest = (route: string, method = "GET") => Effect.promise(() => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const call = request({ socketPath: connection!.socket, path: route, method, headers: {
        "x-opencode-tool-context": reference, "content-type": "application/json", "x-opencode-directory": "/foreign",
      } }, response => {
        const chunks: Buffer[] = []
        response.on("data", chunk => chunks.push(chunk))
        response.on("end", () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString() }))
      })
      call.on("error", reject)
      call.end(method === "POST" ? '{"arguments":{}}' : undefined)
    }))
    const socketCatalog = yield* socketRequest("/api/mcp/catalog/tools")
    expect(socketCatalog.status).toBe(200)
    expect(JSON.parse(socketCatalog.body).data.map((tool: { name: string }) => tool.name)).toEqual(["lookup"])
    const socketDenied = yield* socketRequest("/api/mcp/catalog/tool/private/call", "POST")
    expect(socketDenied.status).toBe(403)
    expect(socketDenied.body).not.toContain("fixture-private-detail")
    expect((yield* socketRequest("/api/mcp/catalog/tool/lookup/call", "POST")).status).toBe(200)
    expect(invoked[1]).toEqual(invoked[0])
    const foreign = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("bridge-foreign-location-")))
    const foreignContext = yield* Effect.promise(() => handler(new Request("http://opencode.local/api/mcp/bridge/context", {
      headers: { "x-opencode-tool-context": reference, "x-opencode-directory": encodeURIComponent(foreign.path) },
    })))
    expect(foreignContext.status).toBe(403)
    expect(yield* Effect.promise(() => foreignContext.text())).not.toContain(reference)
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
    expect((yield* call("model-only")).status).toBe(403)
    // A deny from another installed policy wins over an explicit grant.
    const veto = yield* hooks.register("mcp", "bridge.authorize", event => Effect.sync(() => { event.decision = "deny" }))
    expect((yield* call()).status).toBe(403)
    yield* veto.dispose
    yield* authorize.dispose
    // Metadata alone grants nothing: without an authorizer the ordinary Agent policy denies.
    expect((yield* call()).status).toBe(403)
    yield* hooks.register("mcp", "bridge.authorize", event => Effect.sync(() => { event.decision = "allow" }))
    // Expiry during validation must still stop the subsequent remote side effect.
    yield* hooks.register("mcp", "bridge.validate", () => Scope.close(scope, Exit.void))
    const stale = yield* call()
    expect(stale.status).toBe(403)
    expect(yield* Effect.promise(() => stale.text())).toContain("MCP_BRIDGE_CONTEXT_UNAVAILABLE")
    expect((yield* call()).status).toBe(403)
    expect((yield* catalog("/api/mcp")).status).toBe(403)
    expect((yield* catalog("/api/mcp/catalog/tools")).status).toBe(403)
    expect((yield* catalog("/api/mcp/bridge/context")).status).toBe(403)
    expect(invoked).toHaveLength(2)
    expect(yield* Effect.promise(() => stat(connection!.socket).then(() => true, () => false))).toBe(false)
  }).pipe(Effect.provide(AppNodeBuilder.build(LayerNode.group([ShellContext.node, PluginHooks.node]))), Effect.scoped),
)
