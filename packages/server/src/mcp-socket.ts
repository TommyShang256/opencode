export * as McpSocket from "./mcp-socket"

import { createServer } from "node:http"
import { access, chmod, mkdtemp, realpath, rm, stat } from "node:fs/promises"
import { constants } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { ShellContext } from "@opencode/core/shell/context"

const limit = 4 * 1024 * 1024

/** Node host assembly; clients are trusted deployment inputs, never Shell request parameters. */
export const install = Effect.fn("McpSocket.install")(function* (
  contexts: ShellContext.Interface,
  dispatch: Options["dispatch"],
  client?: string,
) {
  const clients = client === undefined ? [] : [yield* Effect.tryPromise({
    try: async () => {
      if (!path.isAbsolute(client)) throw new Error("Invalid client path")
      const file = await realpath(client)
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(path.basename(file)) || !(await stat(file)).isFile()) {
        throw new Error("Invalid client file")
      }
      await access(file, constants.X_OK)
      return file
    },
    catch: () => new Error("Shell bridge client is unavailable"),
  })]
  yield* contexts.installBridge(async input => {
    const connection = await open({ reference: input.reference, directory: input.directory, workspace: input.workspaceID,
      live: () => Effect.runPromise(contexts.resolve(input.reference)).then(identity => identity !== undefined), dispatch,
    })
    return { socket: connection.path, clients, close: connection.close }
  })
})

export interface Options {
  readonly reference: string
  readonly directory: string
  readonly workspace?: string
  readonly live: () => Promise<boolean>
  /** Existing authenticated Bridge dispatcher; must retain its own invocation and policy checks. */
  readonly dispatch: (request: Request) => Promise<Response>
  readonly timeoutMs?: number
}

/** Host-only transport, not a tool executor or an alternative authorization policy. */
export async function open(options: Options) {
  const timeout = options.timeoutMs ?? 65_000
  if (!Number.isSafeInteger(timeout) || timeout < 1 || !options.reference || !path.isAbsolute(options.directory)) {
    throw new Error("Invalid MCP socket configuration")
  }
  const directory = await mkdtemp(path.join(tmpdir(), "oc-mcp-"))
  const socket = path.join(directory, "bridge.sock")
  const lifetime = new AbortController()
  const server = createServer(async (incoming, outgoing) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    const signal = AbortSignal.any([controller.signal, lifetime.signal])
    const disconnected = () => controller.abort()
    outgoing.once("close", disconnected)
    const failure = (status: number) => {
      if (outgoing.destroyed || outgoing.writableEnded) return
      outgoing.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" })
      outgoing.end(JSON.stringify({ code: "MCP_BRIDGE_UNAVAILABLE" }))
    }
    const aborted = () => { failure(503); incoming.destroy() }
    signal.addEventListener("abort", aborted, { once: true })
    try {
      const target = incoming.url ?? ""
      const allowed = incoming.method === "GET"
        ? /^\/api\/mcp(?:\/[A-Za-z0-9_.:-]+\/tools)?$/.test(target)
        : incoming.method === "POST" && /^\/api\/mcp\/[A-Za-z0-9_.:-]+\/tool\/[A-Za-z0-9_.:-]+\/call$/.test(target)
      if (!allowed || incoming.headers["x-opencode-tool-context"] !== options.reference) {
        failure(403)
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of incoming) {
        size += chunk.length
        if (size > limit) { failure(413); return }
        chunks.push(chunk)
      }
      const body = Buffer.concat(chunks).toString("utf8")
      if (incoming.method === "POST") {
        const parsed: unknown = JSON.parse(body)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          failure(400)
          return
        }
        const keys = Object.keys(parsed)
        // A socket owns the Shell identity. Supplying either identity field is a
        // rejected scope forgery, while other malformed request shapes remain 400.
        if (keys.some(key => key === "sessionId" || key === "agent")) {
          failure(403)
          return
        }
        if (keys.length !== 1 || !("arguments" in parsed)
          || !parsed.arguments || typeof parsed.arguments !== "object" || Array.isArray(parsed.arguments)) {
          failure(400)
          return
        }
      } else if (body) { failure(400); return }
      if (signal.aborted || !(await options.live()) || signal.aborted) { failure(403); return }
      const headers = new Headers({ "accept": "application/json", "content-type": "application/json",
        "x-opencode-tool-context": options.reference, "x-opencode-directory": encodeURIComponent(options.directory) })
      if (options.workspace) headers.set("x-opencode-workspace", options.workspace)
      const response = await options.dispatch(new Request(`http://opencode.local${target}`, {
        method: incoming.method, headers, signal, ...(incoming.method === "POST" ? { body } : {}),
      }))
      if (!response.ok) { await response.body?.cancel(); failure(response.status); return }
      const reader = response.body?.getReader()
      const output: Uint8Array[] = []
      let length = 0
      if (reader) {
        const cancel = () => { void reader.cancel().catch(() => undefined) }
        signal.addEventListener("abort", cancel, { once: true })
        try {
          if (signal.aborted) { await reader.cancel(); return }
          while (true) {
            const next = await reader.read()
            if (next.done) break
            length += next.value.byteLength
            if (length > limit || signal.aborted) { await reader.cancel(); failure(502); return }
            output.push(next.value)
          }
        } finally {
          signal.removeEventListener("abort", cancel)
          reader.releaseLock()
        }
      }
      const payload = Buffer.concat(output).toString("utf8")
      JSON.parse(payload)
      if (signal.aborted || outgoing.destroyed) return
      outgoing.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
      outgoing.end(payload)
    } catch {
      failure(502)
    } finally {
      clearTimeout(timer)
      outgoing.off("close", disconnected)
      signal.removeEventListener("abort", aborted)
    }
  })
  server.requestTimeout = timeout
  server.headersTimeout = timeout
  server.maxHeadersCount = 32
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(socket, () => { server.off("error", reject); resolve() })
    })
    await chmod(socket, 0o600)
  } catch (error) {
    server.close()
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  let closing: Promise<void> | undefined
  return {
    path: socket,
    close: () => closing ??= (async () => {
      lifetime.abort()
      await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() })
      await rm(directory, { recursive: true, force: true })
    })(),
  }
}
