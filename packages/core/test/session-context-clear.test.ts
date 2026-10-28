import { expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionTable } from "@opencode/core/session/sql"
import { toLLMMessages } from "@opencode/core/session/runner/to-llm-message"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(
  LayerNode.group([Database.node, Bus.node, SessionInbox.node, Session.node]),
  [Bus.node.replace(Bus.configured({ persist: true })), SessionExecution.node.replace(SessionExecution.noopLayer)],
))
const model = { id: Model.ID.make("test"), providerID: Provider.ID.make("test") }

const seed = (id: Session.ID) => Effect.gen(function* () {
  const database = yield* Database.Service
  yield* database.db.insert(ProjectTable).values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] }).onConflictDoNothing().run().pipe(Effect.orDie)
  yield* database.db.insert(SessionTable).values({ id, project_id: Project.ID.global, slug: id,
    directory: "/project", title: "Kept title", version: "test", metadata: { kept: true } }).run().pipe(Effect.orDie)
})

it.effect("clear creates an empty durable context while retaining session identity and the original transcript", Effect.gen(function* () {
  const id = Session.ID.make("ses_clear_context")
  yield* seed(id)
  const sessions = yield* Session.Service
  const bus = yield* Bus.Service
  yield* bus.publish(SessionEvent.Synthetic, { sessionID: id, text: "private earlier history" })
  const clearID = SessionMessage.ID.create()
  yield* sessions.clearContext(id, { id: clearID })
  const current = yield* sessions.context(id)
  expect(current).toHaveLength(1)
  expect(current[0]?.metadata?.contextCleared).toBe(true)
  expect(current[0]?.id).toBe(clearID)
  expect(toLLMMessages(current, model)).toEqual([])
  const original = yield* sessions.messages({ sessionID: id })
  expect(JSON.stringify(original)).toContain("private earlier history")
  expect((yield* sessions.get(id)).metadata).toEqual({ kept: true })
  expect((yield* sessions.get(id)).title).toBe("Kept title")
  yield* bus.publish(SessionEvent.Synthetic, { sessionID: id, text: "new context only" })
  yield* sessions.clearContext(id, { id: clearID })
  const resumed = toLLMMessages(yield* sessions.context(id), model)
  expect(JSON.stringify(resumed)).toContain("new context only")
  expect(JSON.stringify(resumed)).not.toContain("private earlier history")
}))

it.effect("clear rejects pending input rather than replaying it after the reset", Effect.gen(function* () {
  const id = Session.ID.make("ses_clear_pending")
  yield* seed(id)
  const inbox = yield* SessionInbox.Service
  yield* inbox.admitCompaction({ sessionID: id, id: SessionMessage.ID.create(), delivery: "queue" })
  const sessions = yield* Session.Service
  const result = yield* Effect.result(sessions.clearContext(id))
  expect(result._tag).toBe("Failure")
  expect(yield* inbox.list(id)).toHaveLength(1)
}))

it.effect("clear rejects unknown sessions", Effect.gen(function* () {
  const sessions = yield* Session.Service
  const result = yield* Effect.result(sessions.clearContext(Session.ID.make("ses_missing")))
  expect(result._tag).toBe("Failure")
}))
