export * as PluginSupervisor from "./supervisor-service.js"

import { Context, Effect } from "effect"

/** Dependency-only supervisor seam used by server startup readiness checks. */
export interface Interface {
  /** Wait for the initial plugin generation and startup updates to settle. */
  readonly flush: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PluginSupervisor") {}
