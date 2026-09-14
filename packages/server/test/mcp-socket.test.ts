import { expect, test } from "bun:test"
import { request } from "node:http"
import { stat } from "node:fs/promises"
import { McpSocket } from "../src/mcp-socket"

function send(socketPath: string, path: string, method = "GET", body?: string, reference = "fixture-reference") {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const call = request({ socketPath, path, method, headers: {
      "x-opencode-tool-context": reference, "content-type": "application/json",
      "x-opencode-directory": "/foreign", cookie: "fixture", authorization: "fixture",
    } }, response => {
      const chunks: Buffer[] = []
      response.on("data", chunk => chunks.push(chunk))
      response.on("end", () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString() }))
    })
    call.on("error", reject)
    call.end(body)
  })
}

test("socket fixes the invocation scope and removes its filesystem endpoint on close", async () => {
  const received: Request[] = []
  const bridge = await McpSocket.open({ reference: "fixture-reference", directory: "/workspace/orders",
    live: async () => true, dispatch: async request => {
      received.push(request)
      return Response.json({ content: [{ type: "text", text: "found" }] })
    } })
  try {
    expect((await stat(bridge.path)).mode & 0o777).toBe(0o600)
    const result = await send(bridge.path, "/api/mcp/catalog/tool/discover/call", "POST", '{"arguments":{"query":"orders"}}')
    expect(result.status).toBe(200)
    expect(received).toHaveLength(1)
    expect(received[0]!.headers.get("x-opencode-directory")).toBe(encodeURIComponent("/workspace/orders"))
    expect(received[0]!.headers.get("authorization")).toBeNull()
    expect(received[0]!.headers.get("cookie")).toBeNull()
    expect(await received[0]!.json()).toEqual({ arguments: { query: "orders" } })
  } finally { await bridge.close() }
  await expect(stat(bridge.path)).rejects.toThrow()
  await bridge.close()
})

test("socket rejects management routes, foreign references and caller-selected session identity", async () => {
  let calls = 0
  let live = true
  const bridge = await McpSocket.open({ reference: "fixture-reference", directory: "/workspace/orders",
    live: async () => live, dispatch: async () => { calls++; return Response.json({ data: [] }) } })
  try {
    for (const target of ["/api/session", "/api/mcp/catalog", "/api/mcp?directory=/foreign",
      "/api/mcp/../session", "/api/mcp/catalog%2Fother/tools", "http://foreign/api/mcp"]) {
      expect((await send(bridge.path, target)).status).toBe(403)
    }
    expect((await send(bridge.path, "/api/mcp", "GET", undefined, "foreign-reference")).status).toBe(403)
    expect((await send(bridge.path, "/api/mcp/catalog/tool/discover/call", "POST",
      '{"arguments":{},"sessionId":"foreign-session"}')).status).toBe(403)
    expect(calls).toBe(0)
    expect((await send(bridge.path, "/api/mcp")).status).toBe(200)
    live = false
    expect((await send(bridge.path, "/api/mcp/catalog/tools")).status).toBe(403)
    expect(calls).toBe(1)
  } finally { await bridge.close() }
})

test("socket removes upstream diagnostics and does not forward redirect headers", async () => {
  let status = 403
  const bridge = await McpSocket.open({ reference: "fixture-reference", directory: "/workspace/orders",
    live: async () => true, dispatch: async () => new Response("private upstream detail", {
      status, headers: { location: "http://foreign/" },
    }) })
  try {
    for (const code of [403, 302, 500, 200]) {
      status = code
      const response = await send(bridge.path, "/api/mcp")
      expect(response.status).toBe(code === 200 ? 502 : code)
      expect(JSON.parse(response.body)).toEqual({ code: "MCP_BRIDGE_UNAVAILABLE" })
    }
  } finally { await bridge.close() }
})

test("closing the socket aborts an in-flight Bridge request", async () => {
  const started = Promise.withResolvers<AbortSignal>()
  const bridge = await McpSocket.open({ reference: "fixture-reference", directory: "/workspace/orders",
    live: async () => true, dispatch: request => {
      started.resolve(request.signal)
      return new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(new Error("cancelled"))))
    } })
  const result = send(bridge.path, "/api/mcp").catch(() => undefined)
  try {
    const signal = await started.promise
    await bridge.close()
    expect(signal.aborted).toBe(true)
    await result
  } finally { await bridge.close() }
})

test("socket deadline cancels a stalled response stream", async () => {
  let cancelled = false
  const bridge = await McpSocket.open({ reference: "fixture-reference", directory: "/workspace/orders", timeoutMs: 40,
    live: async () => true, dispatch: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"data":')) },
      cancel() { cancelled = true },
    })) })
  try {
    await send(bridge.path, "/api/mcp").catch(() => undefined)
    expect(cancelled).toBe(true)
  } finally { await bridge.close() }
})

test("socket bounds the upstream response without returning partial payloads", async () => {
  const bridge = await McpSocket.open({ reference: "fixture-reference", directory: "/workspace/orders",
    live: async () => true, dispatch: async () => Response.json({ data: "x".repeat(4 * 1024 * 1024) }) })
  try {
    const response = await send(bridge.path, "/api/mcp")
    expect(response.status).toBe(502)
    expect(JSON.parse(response.body)).toEqual({ code: "MCP_BRIDGE_UNAVAILABLE" })
  } finally { await bridge.close() }
})
