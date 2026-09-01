import { expect } from "bun:test"
import { Agent } from "@opencode-ai/core/agent"
import { Bus } from "@opencode-ai/core/bus"
import { Model } from "@opencode-ai/core/model"
import { Provider } from "@opencode-ai/core/provider"
import { Session } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Money } from "@opencode-ai/schema/money"
import { Effect, Layer } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("accepts a client-owned native tool result over the session HTTP API", () =>
  Effect.gen(function* () {
    const userMessageID = SessionMessage.ID.create()
    const assistantMessageID = SessionMessage.ID.create()
    let resumes = 0
    const execution = Layer.effect(
      SessionExecution.Service,
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        return SessionExecution.Service.of({
          active: Effect.succeed(new Set()),
          isActive: () => Effect.succeed(false),
          resume: () => Effect.sync(() => void resumes++),
          wake: (sessionID) =>
            Effect.gen(function* () {
              yield* bus.publish(SessionEvent.InboxDelivered, { sessionID, inboxID: userMessageID })
              yield* bus.publish(SessionEvent.Step.Started, {
                sessionID,
                assistantMessageID,
                agent: Agent.defaultID,
                model: { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") },
              })
              yield* bus.publish(SessionEvent.Tool.Input.Started, {
                sessionID,
                assistantMessageID,
                id: "call-present",
                name: "present_artifact",
              })
              yield* bus.publish(SessionEvent.Tool.Input.Ended, {
                sessionID,
                assistantMessageID,
                id: "call-present",
                text: '{"artifactId":"artifact-1"}',
              })
              yield* bus.publish(SessionEvent.Tool.Called, {
                sessionID,
                assistantMessageID,
                id: "call-present",
                input: { artifactId: "artifact-1" },
                executed: false,
              })
              yield* bus.publish(SessionEvent.Tool.WaitingClient, {
                sessionID,
                assistantMessageID,
                id: "call-present",
              })
              yield* bus.publish(SessionEvent.Step.Ended, {
                sessionID,
                assistantMessageID,
                finish: "tool-calls",
                cost: Money.USD.zero,
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              })
            }),
          interrupt: () => Effect.succeed(false),
          awaitIdle: () => Effect.void,
        })
      }),
    )
    const handler = yield* ServerFetch.make(
      {
        app: { version: "test-version" },
        database: { path: ":memory:" },
        config: { project: false },
        models: { fetch: false },
        fs: { filewatcher: false },
      },
      { overrides: [SessionExecution.node.replace(execution)] },
    )
    const created = (yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      ).then((response) => response.json()),
    )) as { data: { id: string } }
    const sessionID = Session.ID.make(created.data.id)

    const prompted = yield* Effect.promise(() =>
      handler(
        new Request(`http://opencode.local/api/session/${sessionID}/prompt`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: userMessageID,
            text: "Present the artifact",
            clientTools: [
              {
                name: "present_artifact",
                description: "Present an artifact in the browser",
                inputSchema: {
                  type: "object",
                  properties: { artifactId: { type: "string" } },
                  required: ["artifactId"],
                },
              },
            ],
          }),
        }),
      ),
    )
    expect(prompted.status).toBe(200)
    const waiting = yield* Effect.promise(() =>
      handler(new Request(`http://opencode.local/api/session/${sessionID}/message/${assistantMessageID}`)).then(
        (response) => response.json(),
      ),
    )
    expect(waiting).toMatchObject({
      data: {
        content: [
          {
            type: "tool",
            id: "call-present",
            name: "present_artifact",
            state: { status: "waiting-client", input: { artifactId: "artifact-1" } },
          },
        ],
      },
    })

    const submitResult = () =>
      handler(
        new Request(`http://opencode.local/api/session/${sessionID}/client-tool-results`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            results: [
              {
                toolCallId: "call-present",
                status: "completed",
                output: { status: "rendered" },
              },
            ],
          }),
        }),
      )
    const submitted = yield* Effect.promise(() => Promise.all([submitResult(), submitResult()]))
    expect(submitted.map((response) => response.status).toSorted()).toEqual([204, 409])
    expect(resumes).toBe(1)
    const message = yield* Effect.promise(() =>
      handler(new Request(`http://opencode.local/api/session/${sessionID}/message/${assistantMessageID}`)).then(
        (response) => response.json(),
      ),
    )
    expect(message).toMatchObject({
      data: {
        content: [
          {
            type: "tool",
            id: "call-present",
            name: "present_artifact",
            state: {
              status: "completed",
              input: { artifactId: "artifact-1" },
              content: [{ type: "text", text: '{"status":"rendered"}' }],
            },
          },
        ],
      },
    })
  }),
)
