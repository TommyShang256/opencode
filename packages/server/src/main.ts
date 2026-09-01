#!/usr/bin/env bun

import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { HttpServer } from "effect/unstable/http"
import { randomBytes } from "node:crypto"
import { start } from "./process"
import { parseStandaloneServerOptions } from "./standalone-options"

declare const OPENCODE_VERSION: string
declare const OPENCODE_CHANNEL: string

const usage = `Usage: opencode2-server [options]

Run the OpenCode HTTP/SSE server without the CLI, TUI, or embedded Web UI.

Options:
  --hostname <host>  Bind address (default: 127.0.0.1)
  --port <port>      TCP port (default: choose an available port)
  --cors <origin>    Allowed browser origin; may be repeated
  -h, --help         Show this help
`

const input = parseStandaloneServerOptions(process.argv.slice(2))
if ("help" in input) {
  console.log(usage)
  process.exit(0)
}

const configuredPassword = process.env.OPENCODE_PASSWORD ?? process.env.OPENCODE_SERVER_PASSWORD
const password = configuredPassword ?? randomBytes(32).toString("base64url")

const program = Effect.scoped(
  Effect.gen(function* () {
    const server = yield* start({
      app: {
        name: process.env.OPENCODE_CLIENT ?? process.env.OPENCODE_APP_NAME ?? "dataagent-server",
        version: OPENCODE_VERSION,
        channel: OPENCODE_CHANNEL,
      },
      hostname: input.hostname,
      port: input.port,
      cors: input.cors,
      password,
      simulation: truthy(process.env.OPENCODE_SIMULATE),
      database: {
        path:
          process.env.OPENCODE_DB ??
          (["latest", "dev", "beta", "next", "prod"].includes(OPENCODE_CHANNEL) ||
          truthy(process.env.OPENCODE_DISABLE_CHANNEL_DB)
            ? "opencode.db"
            : `opencode-${OPENCODE_CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`),
      },
      models: {
        url: process.env.OPENCODE_MODELS_URL,
        file: process.env.OPENCODE_MODELS_PATH,
        fetch: !truthy(process.env.OPENCODE_DISABLE_MODELS_FETCH),
      },
      config: {
        directory: process.env.OPENCODE_CONFIG_DIR,
        project: !truthy(process.env.OPENCODE_CONFIG_PROJECT_DISABLE ?? process.env.OPENCODE_DISABLE_PROJECT_CONFIG),
        file: process.env.OPENCODE_CONFIG,
        content: process.env.OPENCODE_CONFIG_CONTENT,
      },
      windows: { gitbash: process.env.OPENCODE_GIT_BASH_PATH },
      fs: {
        filewatcher: !truthy(process.env.OPENCODE_FILEWATCHER_DISABLE ?? process.env.OPENCODE_DISABLE_FILEWATCHER),
        fff:
          process.env.OPENCODE_DISABLE_FFF === undefined
            ? process.platform !== "win32"
            : !truthy(process.env.OPENCODE_DISABLE_FFF),
      },
    })
    const url = HttpServer.formatAddress(server.address)
    console.log(`OPENCODE_SERVER_LISTENING ${JSON.stringify({ url })}`)
    if (!configuredPassword) console.log(`server password ${password}`)
    return yield* server.shutdown
  }),
).pipe(
  Effect.provide(NodeServices.layer),
  Effect.catchCause((cause) =>
    Effect.logError("server process failed", { cause }).pipe(Effect.andThen(Effect.failCause(cause))),
  ),
  Effect.annotateLogs({ role: "server" }),
)

NodeRuntime.runMain(program)

function truthy(value?: string) {
  return value === "1" || value?.toLowerCase() === "true"
}
