import type { Hooks } from "./registration.js"

export interface ShellCreateBefore {
  /** Native tool caller, absent for direct shell API calls. Not derived from shell metadata. */
  readonly toolContext?: Readonly<{ sessionID: string; messageID: string; executionID: string; agent: string }>
  command: string
  cwd: string
  timeout: number
  shell: string
  env: Record<string, string | undefined>
}

export interface ShellHooks {
  readonly "create.before": ShellCreateBefore
}

export interface ShellDomain {
  readonly hook: Hooks<ShellHooks>
}
