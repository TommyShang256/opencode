import type { McpApi } from "@opencode-ai/client/effect/api"
import type { Mcp } from "@opencode-ai/schema/mcp"
import type { Effect, Types } from "effect"
import type { Hooks, Transform } from "./registration.js"
import type { ShellCreateBefore } from "./shell.js"
import type { Tool } from "@opencode-ai/schema/tool"

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

export interface MCPFailures { readonly "bridge.authorize": Tool.Error; readonly "bridge.validate": Tool.Error; readonly "bridge.catalog": Tool.Error }

export interface MCPDraft {
  list(): readonly [string, Types.DeepMutable<Mcp.ServerConfig>][]
  get(name: string): Types.DeepMutable<Mcp.ServerConfig> | undefined
  set(name: string, config: Mcp.ServerConfig): void
  update(name: string, update: (config: Types.DeepMutable<Mcp.ServerConfig>) => void): void
  remove(name: string): void
}

export interface MCPDomain extends Pick<McpApi<unknown>, "list"> {
  readonly hook: Hooks<MCPHooks, MCPFailures>
  readonly transform: Transform<MCPDraft>
  readonly reload: () => Effect.Effect<void>
}
