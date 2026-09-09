export * as ShellContext from "./context.js"

import type { ShellCreateBefore } from "@opencode-ai/plugin/effect/shell"
import { Context, Effect, Layer, Scope } from "effect"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"

export type Identity = NonNullable<ShellCreateBefore["toolContext"]>

export interface Interface {
  readonly acquire: (identity: Identity) => Effect.Effect<string, never, Scope.Scope>
  readonly resolve: (reference: string) => Effect.Effect<Identity | undefined>
}

/** Process-local references. Resolution proves scope ownership, not permission to call a tool. */
export class Service extends Context.Service<Service, Interface>()("@opencode/ShellContext") {}

const layer = Layer.sync(Service, () => {
  const active = new Map<string, Identity>()
  return Service.of({
    acquire: (identity) => Effect.acquireRelease(
      Effect.sync(() => {
        const reference = crypto.randomUUID()
        active.set(reference, Object.freeze({ ...identity }))
        return reference
      }),
      (reference) => Effect.sync(() => { active.delete(reference) }),
    ),
    resolve: (reference) => Effect.sync(() => active.get(reference)),
  })
})

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
