import type { McpApi } from "@opencode/client/promise/api"
import type { Mcp } from "@opencode/schema/mcp"
import type { Transform } from "./registration.js"
import type { Hooks } from "./registration.js"
import type { ShellCreateBefore } from "./shell.js"

export interface MCPHooks {
  readonly "bridge.authorize": {
    readonly server: string
    readonly tool: string
    readonly input: Record<string, unknown>
    readonly meta?: Readonly<Record<string, unknown>>
    readonly toolContext?: ShellCreateBefore["toolContext"]
    decision: "defer" | "allow" | "deny"
  }
  readonly "bridge.catalog": {
    readonly toolContext?: ShellCreateBefore["toolContext"]
    tools: Array<{ readonly server: string; readonly name: string; readonly meta?: Readonly<Record<string, unknown>> }>
  }
  readonly "bridge.validate": {
    readonly server: string
    readonly tool: string
    readonly input: Record<string, unknown>
    readonly toolContext?: ShellCreateBefore["toolContext"]
  }
}
import type { DeepMutable } from "./types.js"

export interface MCPEditor {
  list(): readonly [string, DeepMutable<Mcp.ServerConfig>][]
  get(name: string): DeepMutable<Mcp.ServerConfig> | undefined
  set(name: string, config: Mcp.ServerConfig): void
  update(name: string, update: (config: DeepMutable<Mcp.ServerConfig>) => void): void
  remove(name: string): void
}

export interface MCPDomain extends Pick<McpApi, "list"> {
  readonly hook: Hooks<MCPHooks>
  readonly transform: Transform<MCPEditor>  readonly reload: () => Promise<void>
}
