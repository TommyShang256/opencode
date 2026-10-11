import { beforeEach, expect, test } from "bun:test"
import {
  AIError,
  LLMClient,
  LLMEvent,
  LanguageModel,
  Message,
  SystemPart,
  TransportError,
  type LLMRequest,
} from "@opencode/ai"
import { OpenAIChat } from "@opencode/ai/protocols"
import { Agent } from "@opencode/core/agent"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { llmClient } from "@opencode/core/effect/app-node-platform"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { SessionTitle } from "@opencode/core/session/title"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { Location } from "@opencode/core/location"
import { Session } from "@opencode/core/session"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { App } from "@opencode/core/app"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Money } from "@opencode/schema/money"
import { Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { testEffect } from "./lib/effect"

let requests: LLMRequest[] = []
let selectedSmall: Model.Info | undefined
let selections: Array<Session.Info["model"]> = []
const model = LanguageModel.make({
  id: "title-model",
  provider: "test",
  route: OpenAIChat.route,
})
const smallModel = LanguageModel.make({
  id: "title-small",
  provider: "test",
  route: OpenAIChat.route,
})
const cost = [
  {
    input: Money.USDPerMillionTokens.make(1),
    output: Money.USDPerMillionTokens.make(2),
    cache: {
      read: Money.USDPerMillionTokens.make(0.1),
      write: Money.USDPerMillionTokens.make(0.5),
    },
  },
]
const successfulTitle = () =>
  Stream.make(
    LLMEvent.textDelta({ id: "title", text: "Generated Title\n" }),
    LLMEvent.stepFinish({
      index: 0,
      reason: { normalized: "stop" },
      usage: {
        inputTokens: 15,
        outputTokens: 6,
        nonCachedInputTokens: 10,
        cacheReadInputTokens: 3,
        cacheWriteInputTokens: 2,
        reasoningTokens: 2,
      },
    }),
    LLMEvent.finish({
      reason: { normalized: "stop" },
    }),
  )
let titleStream: () => Stream.Stream<LLMEvent, AIError> = successfulTitle
const client = Layer.mock(LLMClient.Service)({
  stream: (request: LLMRequest) => {
    requests.push(request)
    return titleStream()
  },
  generate: () => Effect.die("unused"),
})
const models = Layer.mock(SessionRunnerModel.Service)({
  resolve: (session) => {
    selections.push(session.model)
    return Effect.succeed(
      SessionRunnerModel.resolved(session.model?.id === "title-small" ? smallModel : model, {
        capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
        cost,
        limit: { context: 200_000, output: 32_000 },
        variant: session.model?.variant,
      }),
    )
  },
})
const smallModels = Layer.mock(Model.Service, {
  small: () => Effect.succeed(selectedSmall),
})
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      Agent.node,
      PluginHooks.node,
      SessionTitle.node,
    ]),
    [
      llmClient.replace(client),
      Model.node.replace(smallModels),
      SessionRunnerModel.node.replace(models),
      Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
      PluginSupervisor.node.replace(Layer.empty),
    ],
  ),
)

const insertSession = (id: Session.ID, title?: string, created?: number, model?: Model.Ref) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id,
        project_id: Project.ID.global,
        slug: id,
        directory: "/project",
        title,
        model,
        time_created: created,
        version: "test",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
  })

const prompt = (sessionID: Session.ID, text: string) =>
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const messageID = SessionMessage.ID.create()
    yield* bus.publish(SessionEvent.InboxEnqueued, {
      sessionID,
      inboxID: messageID,
      item: { type: "user", payload: { text }, delivery: "steer" },
    })
    yield* bus.publish(SessionEvent.InboxDelivered, {
      sessionID,
      inboxID: messageID,
    })
  })

const small = Model.Info.make({
  ...Model.Info.default(Provider.ID.make("test"), Model.ID.make("title-small")),
  family: Model.Family.make("gpt-luna"),
  capabilities: { tools: false, input: ["text"], output: ["text"] },
  variants: [
    { id: Model.VariantID.make("low") },
    { id: Model.VariantID.make("none") },
    { id: Model.VariantID.make("high") },
  ],
})
const lowSmall = Model.Info.make({
  ...small,
  variants: [{ id: Model.VariantID.make("low") }, { id: Model.VariantID.make("high") }],
})

beforeEach(() => {
  requests = []
  selectedSmall = undefined
  selections = []
  titleStream = successfulTitle
})

const enableTitleAgent = Effect.gen(function* () {
  const agents = yield* Agent.Service
  yield* agents.transform((editor) => {
    editor.update(Agent.ID.make("title"), (agent) => {
      agent.mode = "primary"
      agent.hidden = true
      agent.system = "You are a title generator."
    })
  })
})

it.effect("generates a title from the sole user message and renames the session", () =>
  Effect.gen(function* () {
    yield* enableTitleAgent
    const sessionID = Session.ID.make("ses_title_generate")
    yield* insertSession(sessionID)
    yield* prompt(sessionID, "Help me debug the failing build")

    const store = yield* SessionStore.Service
    const title = yield* SessionTitle.Service
    yield* title.generate(sessionID)

    expect(requests).toHaveLength(1)
    expect(requests[0]?.http?.headers).toEqual({
      "x-session-affinity": sessionID,
      "X-Session-Id": sessionID,
      "User-Agent": App.useragent(App.make()),
      "x-opencode-project": Project.ID.global,
      "x-opencode-session": sessionID,
      "x-opencode-client": "opencode",
    })
    expect(requests[0]?.promptCacheKey).toBe(sessionID)
    expect(requests[0]?.tools).toEqual([])
    expect(requests[0]?.system.map((part) => part.text)).toEqual(["You are a title generator."])
    expect(JSON.stringify(requests[0]?.messages)).toContain("Help me debug the failing build")
    const renamed = yield* store.get(sessionID)
    expect(renamed?.title).toBe("Generated Title")
    expect(renamed?.tokens).toEqual({ input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 2 } })
    expect(renamed?.cost).toBeCloseTo(0.0000233)
  }),
)

it.effect("runs title hooks instead of context hooks", () =>
  Effect.gen(function* () {
    yield* enableTitleAgent
    const sessionID = Session.ID.make("ses_title_hook")
    yield* insertSession(sessionID)
    yield* prompt(sessionID, "Redact this message")

    const hooks = yield* PluginHooks.Service
    let contexts = 0
    yield* hooks.register("session", "context", () => Effect.sync(() => contexts++))
    yield* hooks.register("session", "title", (event) =>
      Effect.sync(() => {
        expect(event.sessionID).toBe(sessionID)
        expect(event.system.map((part) => part.text)).toEqual(["You are a title generator."])
        event.system.push(SystemPart.make("Prefer short titles."))
        event.messages = [Message.user("[redacted]")]
        event.options.maxTokens = 32
        event.options.reasoningEffort = "low"
      }),
    )

    const title = yield* SessionTitle.Service
    yield* title.generate(sessionID)

    expect(contexts).toBe(0)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.system.map((part) => part.text)).toEqual(["You are a title generator.", "Prefer short titles."])
    expect(JSON.stringify(requests[0]?.messages)).not.toContain("Redact this message")
    expect(requests[0]?.generation).toEqual(expect.objectContaining({ maxTokens: 32 }))
    expect(requests[0]?.providerOptions).toEqual({ reasoningEffort: "low" })
  }),
)

it.effect("uses a hook-provided title without a model request", () =>
  Effect.gen(function* () {
    yield* enableTitleAgent
    const sessionID = Session.ID.make("ses_title_result")
    yield* insertSession(sessionID)
    yield* prompt(sessionID, "Hello")

    const hooks = yield* PluginHooks.Service
    yield* hooks.register("session", "title", (event) =>
      Effect.sync(() => {
        event.result = "Plugin Title"
      }),
    )

    const title = yield* SessionTitle.Service
    yield* title.generate(sessionID)

    expect(requests).toHaveLength(0)
    const store = yield* SessionStore.Service
    expect((yield* store.get(sessionID))?.title).toBe("Plugin Title")
  }),
)

it.effect("uses a small model from the primary provider", () =>
  Effect.gen(function* () {
    selectedSmall = small
    yield* enableTitleAgent
    const sessionID = Session.ID.make("ses_title_small_model")
    yield* insertSession(sessionID)
    yield* prompt(sessionID, "Use a small model for this title")

    const title = yield* SessionTitle.Service
    yield* title.generate(sessionID)

    expect(requests.map((request) => String(request.model.id))).toEqual(["title-small"])
    expect(selections[1]?.variant).toBe(Model.VariantID.make("none"))
    const store = yield* SessionStore.Service
    expect((yield* store.get(sessionID))?.title).toBe("Generated Title")
  }),
)

it.effect("falls back to the primary model when the small model fails", () =>
  Effect.gen(function* () {
    titleStream = () =>
      requests.length === 1
        ? Stream.make(LLMEvent.providerError({ message: "Small model unavailable" }))
        : successfulTitle()
    selectedSmall = lowSmall
    yield* enableTitleAgent
    const sessionID = Session.ID.make("ses_title_small_fallback")
    yield* insertSession(
      sessionID,
      undefined,
      undefined,
      Model.Ref.make({
        providerID: Provider.ID.make("test"),
        id: Model.ID.make("title-model"),
        variant: Model.VariantID.make("high"),
      }),
    )
    yield* prompt(sessionID, "Fall back when title generation fails")

    const attempted: Model.Ref[] = []
    const hooks = yield* PluginHooks.Service
    yield* hooks.register("session", "model.request", (event) =>
      Effect.sync(() => {
        attempted.push(event.model)
      }),
    )

    const title = yield* SessionTitle.Service
    yield* title.generate(sessionID)

    expect(requests.map((request) => String(request.model.id))).toEqual(["title-small", "title-model"])
    expect(attempted.map((model) => String(model.variant))).toEqual(["low", "high"])
    const store = yield* SessionStore.Service
    expect((yield* store.get(sessionID))?.title).toBe("Generated Title")
  }),
)

it.effect("generates from the first user message after later messages exist", () =>
  Effect.gen(function* () {
    yield* enableTitleAgent
    const sessionID = Session.ID.make("ses_title_second_message")
    yield* insertSession(sessionID)
    yield* prompt(sessionID, "First message")
    yield* prompt(sessionID, "Second message")

    const store = yield* SessionStore.Service
    const title = yield* SessionTitle.Service
    yield* title.generate(sessionID)

    expect(requests).toHaveLength(1)
    expect(JSON.stringify(requests[0]?.messages)).toContain("First message")
    expect(JSON.stringify(requests[0]?.messages)).not.toContain("Second message")
    expect((yield* store.get(sessionID))?.title).toBe("Generated Title")
  }),
)

it.effect("retries a legacy persisted fallback title", () =>
  Effect.gen(function* () {
    yield* enableTitleAgent
    const sessionID = Session.ID.make("ses_title_legacy")
    const created = Date.parse("2026-07-30T18:45:03.662Z")
    yield* insertSession(sessionID, "New session - 2026-07-30T18:45:03.662Z", created)
    yield* prompt(sessionID, "Retry the legacy title")

    const title = yield* SessionTitle.Service
    yield* title.generate(sessionID)

    const store = yield* SessionStore.Service
    expect(requests).toHaveLength(1)
    expect((yield* store.get(sessionID))?.title).toBe("Generated Title")
  }),
)

it.effect("generates a title for an explicitly requested child session", () =>
  Effect.gen(function* () {
    yield* enableTitleAgent
    const sessionID = Session.ID.make("ses_title_child")
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        parent_id: Session.ID.make("ses_title_parent"),
        slug: sessionID,
        directory: "/project",
        version: "test",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* prompt(sessionID, "Do this subtask")

    const title = yield* SessionTitle.Service
    yield* title.generate(sessionID)
    const store = yield* SessionStore.Service
    expect(requests).toHaveLength(1)
    expect((yield* store.get(sessionID))?.title).toBe("Generated Title")
  }),
)

it.effect("does not generate when the title agent is removed", () =>
  Effect.gen(function* () {
    const sessionID = Session.ID.make("ses_title_no_agent")
    yield* insertSession(sessionID)
    yield* prompt(sessionID, "Help me debug the failing build")

    const store = yield* SessionStore.Service
    const title = yield* SessionTitle.Service
    yield* title.generate(sessionID)

    expect(requests).toHaveLength(0)
    const untouched = yield* store.get(sessionID)
    expect(untouched?.title).toBeUndefined()
  }),
)

it.effect("regenerates an existing title using the title agent", () =>
  Effect.gen(function* () {
    yield* enableTitleAgent
    const sessionID = Session.ID.make("ses_title_regenerate")
    yield* insertSession(sessionID, "Original title")
    yield* prompt(sessionID, "Investigate the login failure")
    const events = yield* Bus.Service
    const assistantMessageID = SessionMessage.ID.create()
    yield* events.publish(SessionEvent.Step.Started, {
      sessionID,
      assistantMessageID,
      agent: Agent.ID.make("build"),
      model: Model.Ref.make({ id: Model.ID.make("title-model"), providerID: Provider.ID.make("test") }),
      started: 0,
    })
    yield* events.publish(SessionEvent.Reasoning.Started, { sessionID, assistantMessageID, ordinal: 0 })
    yield* events.publish(SessionEvent.Reasoning.Ended, {
      sessionID,
      assistantMessageID,
      ordinal: 0,
      text: "Private reasoning that should not appear",
    })
    yield* events.publish(SessionEvent.Text.Started, { sessionID, assistantMessageID, ordinal: 1 })
    yield* events.publish(SessionEvent.Text.Ended, {
      sessionID,
      assistantMessageID,
      ordinal: 1,
      text: "The actual issue is expired OAuth credentials.",
    })
    yield* prompt(sessionID, "Switch to fixing OAuth token refresh")

    const title = yield* SessionTitle.Service
    yield* title.generate(sessionID)

    const store = yield* SessionStore.Service
    expect(requests).toHaveLength(1)
    expect(requests[0]?.system.map((part) => part.text)).toEqual(["You are a title generator."])
    expect(JSON.stringify(requests[0]?.messages)).toContain("Investigate the login failure")
    expect(JSON.stringify(requests[0]?.messages)).toContain("The actual issue is expired OAuth credentials.")
    expect(JSON.stringify(requests[0]?.messages)).toContain("Switch to fixing OAuth token refresh")
    expect(JSON.stringify(requests[0]?.messages)).not.toContain("Private reasoning that should not appear")
    expect((yield* store.get(sessionID))?.title).toBe("Generated Title")
  }),
)

it.effect("bounds regeneration context while preserving the original request and recent conversation", () =>
  Effect.gen(function* () {
    yield* enableTitleAgent
    const sessionID = Session.ID.make("ses_title_regenerate_bounded")
    yield* insertSession(sessionID, "Original title")
    yield* prompt(sessionID, `ORIGINAL_GOAL ${"a".repeat(3_000)} OMITTED_ORIGINAL_END`)
    yield* prompt(sessionID, `OMITTED_OLD_CONTEXT ${"b".repeat(9_000)} RECENT_GOAL`)

    const title = yield* SessionTitle.Service
    yield* title.generate(sessionID)

    const content = requests[0]?.messages[0]?.content[0]
    expect(content?.type).toBe("text")
    if (content?.type !== "text") return
    expect(content.text.length).toBeLessThanOrEqual(8_000)
    expect(content.text).toContain("ORIGINAL_GOAL")
    expect(content.text).toContain("RECENT_GOAL")
    expect(content.text).not.toContain("OMITTED_ORIGINAL_END")
    expect(content.text).not.toContain("OMITTED_OLD_CONTEXT")
  }),
)

it.effect("preserves the existing title when regeneration fails", () =>
  Effect.gen(function* () {
    yield* enableTitleAgent
    const sessionID = Session.ID.make("ses_title_regenerate_failure")
    yield* insertSession(sessionID, "Original title")
    yield* prompt(sessionID, "Fail to regenerate this title")
    titleStream = () => Stream.make(LLMEvent.providerError({ message: "Provider unavailable" }))

    const title = yield* SessionTitle.Service
    yield* title.generate(sessionID)

    const store = yield* SessionStore.Service
    expect(requests).toHaveLength(1)
    expect((yield* store.get(sessionID))?.title).toBe("Original title")
  }),
)

it.effect("retries after a failed title request", () =>
  Effect.gen(function* () {
    yield* enableTitleAgent
    const sessionID = Session.ID.make("ses_title_retry")
    yield* insertSession(sessionID)
    yield* prompt(sessionID, "Retry this title")
    const title = yield* SessionTitle.Service
    titleStream = () => Stream.make(LLMEvent.providerError({ message: "Provider unavailable" }))

    yield* title.generate(sessionID)
    titleStream = successfulTitle
    yield* title.generate(sessionID)

    const store = yield* SessionStore.Service
    expect(requests).toHaveLength(2)
    expect((yield* store.get(sessionID))?.title).toBe("Generated Title")
  }),
)

it.effect("falls back to the user prompt after a failed title stream", () =>
  Effect.gen(function* () {
    yield* enableTitleAgent
    const sessionID = Session.ID.make("ses_title_stream_failure")
    yield* insertSession(sessionID)
    yield* prompt(sessionID, "Fail this title stream")
    titleStream = () =>
      Stream.fail(
        new AIError({
          reason: new TransportError({ message: "Disconnected", transport: "http", operation: "request" }),
        }),
      )

    const title = yield* SessionTitle.Service
    yield* title.generate(sessionID)

    const store = yield* SessionStore.Service
    expect(requests).toHaveLength(1)
    expect((yield* store.get(sessionID))?.title).toBe("Fail this title stream")
  }),
)

it.effect("falls back to the wrapped user message after title generation fails", () =>
  Effect.gen(function* () {
    yield* enableTitleAgent
    const sessionID = Session.ID.make("ses_title_wrapped_failure")
    yield* insertSession(sessionID)
    yield* prompt(sessionID, `<environment>
数据工作目录: /workspace/data
</environment>

<user_message>
查询月度销售趋势
</user_message>`)
    titleStream = () => Stream.make(LLMEvent.providerError({ message: "Provider unavailable" }))

    const title = yield* SessionTitle.Service
    yield* title.generate(sessionID)

    const store = yield* SessionStore.Service
    expect((yield* store.get(sessionID))?.title).toBe("查询月度销售趋势")
  }),
)

it.effect("preserves a manual rename completed while generation is in flight", () =>
  Effect.gen(function* () {
    yield* enableTitleAgent
    const sessionID = Session.ID.make("ses_title_manual_rename")
    yield* insertSession(sessionID)
    yield* prompt(sessionID, "Generate this title")
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    titleStream = () =>
      Stream.unwrap(
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.as(successfulTitle()),
        ),
      )
    const title = yield* SessionTitle.Service
    const fiber = yield* title.generate(sessionID).pipe(Effect.forkScoped)
    yield* Deferred.await(started)
    const events = yield* Bus.Service
    yield* events.publish(SessionEvent.Renamed, { sessionID, title: "Manual title" })
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(fiber)

    const store = yield* SessionStore.Service
    expect(requests).toHaveLength(1)
    expect((yield* store.get(sessionID))?.title).toBe("Manual title")
  }),
)

it.effect("cleans markdown headers from title generator output", () =>
  Effect.gen(function* () {
    yield* enableTitleAgent
    const sessionID = Session.ID.make("ses_title_markdown_header")
    yield* insertSession(sessionID)
    yield* prompt(sessionID, "Setup database connections")
    titleStream = () =>
      Stream.make(
        LLMEvent.textDelta({ id: "title", text: "## Database Connection Setup\n" }),
        LLMEvent.stepFinish({
          index: 0,
          reason: { normalized: "stop" },
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            nonCachedInputTokens: 10,
            cacheReadInputTokens: 0,
            cacheWriteInputTokens: 0,
            reasoningTokens: 0,
          },
        }),
        LLMEvent.finish({ reason: { normalized: "stop" } }),
      )

    const title = yield* SessionTitle.Service
    yield* title.generate(sessionID)

    const store = yield* SessionStore.Service
    expect((yield* store.get(sessionID))?.title).toBe("Database Connection Setup")
  }),
)

it.effect("filters out tool call and thinking content from context passed to title agent", () =>
  Effect.gen(function* () {
    yield* enableTitleAgent
    const sessionID = Session.ID.make("ses_title_filter_tool_calls")
    yield* insertSession(sessionID, "Initial Title")
    yield* prompt(sessionID, "查询活跃用户指标定义")

    const events = yield* Bus.Service
    const assistantMessageID = SessionMessage.ID.create()
    yield* events.publish(SessionEvent.Step.Started, {
      sessionID,
      assistantMessageID,
      agent: Agent.ID.make("build"),
      model: Model.Ref.make({ id: Model.ID.make("title-model"), providerID: Provider.ID.make("test") }),
    })
    yield* events.publish(SessionEvent.Text.Started, { sessionID, assistantMessageID, ordinal: 0 })
    yield* events.publish(SessionEvent.Text.Ended, {
      sessionID,
      assistantMessageID,
      ordinal: 0,
      text: `<thinking>Need to query knowledge base</thinking>\n<tool_call>{"name": "search_knowledge", "arguments": {"query": "活跃用户 定义"}}</tool_call>\n活跃用户是指在统计周期内有登录或使用行为的用户。`,
    })
    yield* prompt(sessionID, "请进一步细化为日活口径")

    const title = yield* SessionTitle.Service
    yield* title.generate(sessionID)

    expect(requests).toHaveLength(1)
    const promptText = JSON.stringify(requests[0]?.messages)
    expect(promptText).toContain("活跃用户是指在统计周期内有登录或使用行为的用户。")
    expect(promptText).not.toContain("<tool_call")
    expect(promptText).not.toContain("search_knowledge")
    expect(promptText).not.toContain("<thinking>")
  }),
)

it.effect("falls back to user prompt when title agent returns raw tool call for untitled session", () =>
  Effect.gen(function* () {
    yield* enableTitleAgent
    const sessionID = Session.ID.make("ses_title_tool_call_fallback")
    yield* insertSession(sessionID)
    yield* prompt(sessionID, "查询活跃用户指标定义")

    titleStream = () =>
      Stream.make(
        LLMEvent.textDelta({
          id: "title",
          text: '# <tool_call>{"name": "search_knowledge", "arguments": {"query": "活跃用户 定义"}}</tool_call>\n',
        }),
        LLMEvent.stepFinish({
          index: 0,
          reason: { normalized: "stop" },
          usage: {
            inputTokens: 10,
            outputTokens: 10,
            nonCachedInputTokens: 10,
            cacheReadInputTokens: 0,
            cacheWriteInputTokens: 0,
            reasoningTokens: 0,
          },
        }),
        LLMEvent.finish({ reason: { normalized: "stop" } }),
      )

    const title = yield* SessionTitle.Service
    yield* title.generate(sessionID)

    const store = yield* SessionStore.Service
    const current = yield* store.get(sessionID)
    expect(current?.title).toBe("查询活跃用户指标定义")
  }),
)

it.effect("preserves existing title when title agent returns raw tool call during regeneration", () =>
  Effect.gen(function* () {
    yield* enableTitleAgent
    const sessionID = Session.ID.make("ses_title_tool_call_preserve_existing")
    yield* insertSession(sessionID, "Existing Valid Title")
    yield* prompt(sessionID, "Another message")

    titleStream = () =>
      Stream.make(
        LLMEvent.textDelta({
          id: "title",
          text: '<tool_call>{"name": "search_knowledge", "arguments": {"query": "test"}}</tool_call>',
        }),
        LLMEvent.stepFinish({
          index: 0,
          reason: { normalized: "stop" },
          usage: {
            inputTokens: 10,
            outputTokens: 10,
            nonCachedInputTokens: 10,
            cacheReadInputTokens: 0,
            cacheWriteInputTokens: 0,
            reasoningTokens: 0,
          },
        }),
        LLMEvent.finish({ reason: { normalized: "stop" } }),
      )

    const title = yield* SessionTitle.Service
    yield* title.generate(sessionID)

    const store = yield* SessionStore.Service
    const current = yield* store.get(sessionID)
    expect(current?.title).toBe("Existing Valid Title")
  }),
)

test("cleanTitle rejects invalid tool call content and normalizes valid titles", () => {
  const bar = "\uFF5C"
  const dsml = `<${bar}${bar}DSML${bar}${bar} calls>\n`
    + `<${bar}${bar}DSML${bar}${bar} invoke name="navigator_read_job">\n`
    + `</${bar}${bar}DSML${bar}${bar} invoke>\n`
    + `</${bar}${bar}DSML${bar}${bar} calls>`
  expect(SessionTitle.cleanTitle('# <tool_call>{"name": "search_knowledge"}</tool_call>')).toBeUndefined()
  expect(SessionTitle.cleanTitle('<tool_call>{"name": "search_knowledge"}</tool_call>')).toBeUndefined()
  expect(SessionTitle.cleanTitle(dsml)).toBeUndefined()
  expect(SessionTitle.cleanTitle('{"name": "search_knowledge", "arguments": {}}')).toBeUndefined()
  expect(SessionTitle.cleanTitle('<tool_response>result</tool_response>')).toBeUndefined()
  expect(SessionTitle.cleanTitle("<thinking>internal thoughts</thinking>")).toBeUndefined()
  expect(SessionTitle.cleanTitle("")).toBeUndefined()
  expect(SessionTitle.cleanTitle("   ")).toBeUndefined()

  expect(SessionTitle.cleanTitle("# Fix Login Issue")).toBe("Fix Login Issue")
  expect(SessionTitle.cleanTitle("### \"OAuth Token Refresh\"")).toBe("OAuth Token Refresh")
  expect(SessionTitle.cleanTitle("- User Registration Flow")).toBe("User Registration Flow")
  expect(SessionTitle.cleanTitle("活跃用户指标口径定义")).toBe("活跃用户指标口径定义")
})

test("cleanMessageText strips tool tags, thinking blocks, and tool JSON payloads", () => {
  const bar = "\uFF5C"
  const dirty = `
<thinking>
Planning next step
</thinking>
<tool_call>
{"name": "search_knowledge", "arguments": {"query": "test"}}
</tool_call>
Here is the actual answer for the user.
`
  const cleaned = SessionTitle.cleanMessageText(dirty)
  expect(cleaned).toBe("Here is the actual answer for the user.")
  expect(cleaned).not.toContain("<thinking>")
  expect(cleaned).not.toContain("<tool_call>")
  expect(cleaned).not.toContain("search_knowledge")

  const dsml = `<${bar}${bar}DSML${bar}${bar} calls>\n`
    + `<${bar}${bar}DSML${bar}${bar} invoke name="navigator_read_job">\n`
    + `</${bar}${bar}DSML${bar}${bar} invoke>\n`
    + `</${bar}${bar}DSML${bar}${bar} calls>`
  expect(SessionTitle.cleanMessageText(`Before\n${dsml}\nAfter`)).toBe("Before\nAfter")

  const withCodeBlock = `
\`\`\`json
{
  "name": "search_knowledge",
  "arguments": {"query": "test"}
}
\`\`\`
Found relevant results.
`
  const cleanedCodeBlock = SessionTitle.cleanMessageText(withCodeBlock)
  expect(cleanedCodeBlock).toBe("Found relevant results.")
})

test("cleanMessageText strips environment, user_message and attachments wrapper tags", () => {
  const wrapped = `<environment>
数据工作目录: /workspace/data
项目: demo-project
</environment>

<user_message>
查询月度销售趋势
</user_message>`
  const cleaned = SessionTitle.cleanMessageText(wrapped)
  expect(cleaned).toBe("查询月度销售趋势")
  expect(cleaned).not.toContain("<environment>")
  expect(cleaned).not.toContain("<user_message>")

  const withAttachments = `<attachments>file1.csv</attachments>
请分析这份数据`
  expect(SessionTitle.cleanMessageText(withAttachments)).toBe("请分析这份数据")
})

test("cleanMessageText keeps only the user's words when a host wraps them among instruction blocks", () => {
  const wrapped = `<server_tools>
You can render rich UI surfaces with render_a2ui.
</server_tools>

<project_resources_json>{"project":{"id":"default"},"knowledge":[]}</project_resources_json>

<user_message>
请整理知识资料“通信分析SQL与校验方式”
</user_message>

<delivery_execution>
If the user supplied the needed facts inline, do not inspect workspace files.
</delivery_execution>`
  expect(SessionTitle.cleanMessageText(wrapped)).toBe("请整理知识资料“通信分析SQL与校验方式”")
})

test("cleanTitle does not reject titles containing 'query' in natural language", () => {
  expect(SessionTitle.cleanTitle("ClickHouse slow query 优化")).toBe("ClickHouse slow query 优化")
  expect(SessionTitle.cleanTitle("GraphQL query 语法解析")).toBe("GraphQL query 语法解析")
  // But still rejects JSON-like lines with "query":
  expect(SessionTitle.cleanTitle('{"query": "test", "limit": 10}')).toBeUndefined()
})

test("cleanTitle rejects lines containing both name and arguments keys", () => {
  expect(SessionTitle.cleanTitle('Tool: {"name": "search", "arguments": {"q": "test"}}')).toBeUndefined()
  // But allows titles that only mention "name" without "arguments"
  expect(SessionTitle.cleanTitle("User name validation flow")).toBe("User name validation flow")
})

test("cleanMessageText uses line-level filtering for JSON tool calls", () => {
  // Should NOT delete text between unrelated { and "name" across lines
  const multiline = `We need to check { "id": 1 }
This is important context about the data pipeline.
The pipeline processes data daily.`
  const cleaned = SessionTitle.cleanMessageText(multiline)
  expect(cleaned).toContain("This is important context about the data pipeline.")
  expect(cleaned).toContain("The pipeline processes data daily.")

  // Single-line tool call JSON should still be filtered
  const withToolLine = `Here is the answer.
{"name": "search_knowledge", "arguments": {"query": "test"}}
The results are good.`
  const cleanedTool = SessionTitle.cleanMessageText(withToolLine)
  expect(cleanedTool).toContain("Here is the answer.")
  expect(cleanedTool).toContain("The results are good.")
  expect(cleanedTool).not.toContain("search_knowledge")
})
