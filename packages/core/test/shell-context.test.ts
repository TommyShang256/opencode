import { describe, expect } from "bun:test"
import { Effect, Exit, Scope } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { ShellContext } from "@opencode-ai/core/shell/context"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(ShellContext.node))

describe("ShellContext", () => {
  it.effect("closes a bridge connection with its execution scope without touching another execution", () =>
    Effect.gen(function* () {
      const contexts = yield* ShellContext.Service
      const closed: string[] = []
      yield* contexts.installBridge(async input => ({ socket: `/tmp/${input.reference}.sock`, clients: [],
        close: async () => { closed.push(input.reference) },
      }))
      const first = yield* Scope.make()
      const second = yield* Scope.make()
      const identity = { sessionID: "ses_one", messageID: "msg_one", executionID: "call_one", agent: "build" }
      const a = yield* contexts.acquire(identity).pipe(Scope.provide(first))
      const b = yield* contexts.acquire({ ...identity, executionID: "call_two" }).pipe(Scope.provide(second))
      const location = { directory: "/workspace" }
      expect((yield* contexts.connect(a, location).pipe(Scope.provide(first)))?.socket).toContain(a)
      expect((yield* contexts.connect(b, location).pipe(Scope.provide(second)))?.socket).toContain(b)
      yield* Scope.close(first, Exit.void)
      expect(closed).toEqual([a])
      expect(yield* contexts.resolve(a)).toBeUndefined()
      expect(yield* contexts.resolve(b)).toEqual({ ...identity, executionID: "call_two" })
      yield* Scope.close(second, Exit.void)
      expect(closed).toEqual([a, b])
    }).pipe(Effect.scoped),
  )

  it.effect("isolates execution references and revokes only the closed scope", () =>
    Effect.gen(function* () {
      const contexts = yield* ShellContext.Service
      const first = yield* Scope.make()
      const second = yield* Scope.make()
      const identity = { sessionID: "ses_one", messageID: "msg_one", executionID: "call_one", agent: "build" }
      const a = yield* contexts.acquire(identity).pipe(Scope.provide(first))
      const b = yield* contexts.acquire({ ...identity, sessionID: "ses_two", executionID: "call_two" }).pipe(Scope.provide(second))
      expect(a === b).toBe(false)
      identity.sessionID = "changed"
      expect((yield* contexts.resolve(a))?.sessionID).toBe("ses_one")
      expect(yield* contexts.resolve("unissued-reference")).toBeUndefined()
      yield* Scope.close(first, Exit.void)
      expect(yield* contexts.resolve(a)).toBeUndefined()
      expect((yield* contexts.resolve(b))?.sessionID).toBe("ses_two")
      yield* Scope.close(second, Exit.void)
      expect(yield* contexts.resolve(b)).toBeUndefined()
    }),
  )
})
