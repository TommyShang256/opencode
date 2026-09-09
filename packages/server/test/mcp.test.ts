import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

for (const endpoint of ["/api/mcp", "/api/mcp/catalog/tools"]) {
  it.live(`loads configured MCP servers before the first ${endpoint} request`, () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-mcp-endpoint-")))
      yield* Effect.promise(() => Bun.write(path.join(tmp.path, "opencode.json"), JSON.stringify({
        mcp: { servers: { catalog: { type: "remote", url: "http://localhost:1/mcp", disabled: true } } },
      })))
      const server = yield* startServer(tmp.path)
      const url = new URL(endpoint, server.base)
      url.searchParams.set("location[directory]", tmp.path)
      const response = yield* Effect.promise(() => fetch(url, { headers: server.headers }))
      expect(response.status).toBe(200)
      const body = yield* Effect.promise(() => response.json())
      if (endpoint === "/api/mcp") {
        expect(body.data).toContainEqual(expect.objectContaining({ name: "catalog", status: { status: "disabled" } }))
      } else {
        expect(body.data).toEqual([])
      }
    }),
  )
}
