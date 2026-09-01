import { parseArgs } from "node:util"

export type StandaloneServerOptions =
  | { readonly help: true }
  | {
      readonly hostname?: string
      readonly port?: number
      readonly cors?: readonly string[]
    }

export function parseStandaloneServerOptions(args: readonly string[]): StandaloneServerOptions {
  const parsed = parseArgs({
    args: [...args],
    strict: true,
    allowPositionals: false,
    options: {
      help: { type: "boolean", short: "h", default: false },
      hostname: { type: "string" },
      port: { type: "string" },
      cors: { type: "string", multiple: true },
    },
  })
  if (parsed.values.help) return { help: true }

  const text = parsed.values.port
  const port = text === undefined ? undefined : Number(text)
  if (port !== undefined && !Number.isInteger(port)) throw new Error("port must be an integer")
  if (port !== undefined && (port < 1 || port > 65_535)) throw new Error("port must be between 1 and 65535")
  return {
    ...(parsed.values.hostname ? { hostname: parsed.values.hostname } : {}),
    ...(port === undefined ? {} : { port }),
    ...(parsed.values.cors?.length ? { cors: parsed.values.cors } : {}),
  }
}
