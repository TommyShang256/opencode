export * as ShellContext from "./context.js"

import type { ShellCreateBefore } from "@opencode-ai/plugin/effect/shell"
import { Context, Effect, Layer, Scope } from "effect"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"

export type Identity = NonNullable<ShellCreateBefore["toolContext"]>

export interface Connection {
  readonly socket: string
  readonly clients: ReadonlyArray<string>
  readonly close: () => Promise<void>
}

export interface Placement {
  readonly directory: string
  readonly workspaceID?: string
}

export type Bridge = (input: Placement & { readonly reference: string }) => Promise<Connection>

export interface Interface {
  readonly acquire: (identity: Identity) => Effect.Effect<string, never, Scope.Scope>
  readonly resolve: (reference: string) => Effect.Effect<Identity | undefined>
  readonly installBridge: (bridge: Bridge) => Effect.Effect<void, never, Scope.Scope>
  readonly connect: (reference: string, placement: Placement) => Effect.Effect<Connection | undefined, Error, Scope.Scope>
}

/** Process-local references. Resolution proves scope ownership, not permission to call a tool. */
export class Service extends Context.Service<Service, Interface>()("@opencode/ShellContext") {}

const layer = Layer.sync(Service, () => {
  const active = new Map<string, Identity>()
  let bridge: Bridge | undefined
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
    installBridge: (factory) => Effect.acquireRelease(
      Effect.sync(() => {
        if (bridge) throw new Error("Shell bridge is already installed")
        bridge = factory
      }),
      () => Effect.sync(() => { bridge = undefined }),
    ),
    connect: (reference, placement) => Effect.gen(function* () {
      if (!active.has(reference)) return yield* Effect.fail(new Error("Shell context is unavailable"))
      const factory = bridge
      if (!factory) return undefined
      const connection = yield* Effect.acquireRelease(
        Effect.tryPromise({ try: () => factory({ ...placement, reference }), catch: () => new Error("Shell bridge is unavailable") }),
        (connection) => Effect.promise(() => connection.close()),
      )
      if (!active.has(reference)) return yield* Effect.fail(new Error("Shell context is unavailable"))
      return connection
    }),
  })
})

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
