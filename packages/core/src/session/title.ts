export * as SessionTitle from "./title.js"

import { isDeepStrictEqual } from "node:util"
import { LLMClient, LLMEvent, Message, SystemPart } from "@opencode/ai"
import type { Agent } from "@opencode/schema/agent"
import { Context, DateTime, Effect, Layer, Stream } from "effect"
import { Database } from "../database/database.js"
import { Bus } from "../bus.js"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { isExactRootFallback } from "@opencode/util/session-title-fallback"
import { llmClient } from "../effect/app-node-platform.js"
import { SessionContext } from "./context.js"
import { SessionEvent } from "./event.js"
import { SessionHistory } from "./history.js"
import type { SessionRunnerModel } from "./runner/model.js"
import { SessionSchema } from "./schema.js"
import { SessionUsage } from "./usage.js"
import { SessionStore } from "./store.js"

const MAX_LENGTH = 100
const MAX_CONTEXT_LENGTH = 8_000
const MAX_FIRST_MESSAGE_LENGTH = 2_000
const titleChanged = Symbol("Session title changed")

export interface Interface {
  /** Generates an initial title or regenerates one from bounded conversation history. */
  readonly generate: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionTitle") {}

const truncate = (value: string) => (value.length <= MAX_LENGTH ? value : `${value.slice(0, MAX_LENGTH - 3)}...`)
export const isUntitled = (session: SessionSchema.Info) =>
  isExactRootFallback({
    title: session.title,
    time: { created: DateTime.toEpochMillis(session.time.created) },
  })

const DSML_TOOL_CALL = /<[|\uFF5C]+DSML[|\uFF5C]+\s*(?:tool_)?calls>/i
const DSML_TOOL_CALL_BLOCK = /<[|\uFF5C]+DSML[|\uFF5C]+\s*(?:tool_)?calls>[\s\S]*?(?:<\/[|\uFF5C]+DSML[|\uFF5C]+\s*(?:tool_)?calls>|$)/gi

const USER_MESSAGE_BLOCK = /<user_message>([\s\S]*?)(?:<\/user_message>|$)/gi

export const cleanMessageText = (raw: string): string => {
  if (!raw) return ""
  // Hosts may wrap the user's words in <user_message> among their own instruction and context blocks
  // (server tools, project resources, delivery rules). Only the user's words describe the conversation.
  const userMessages = [...raw.matchAll(USER_MESSAGE_BLOCK)].map((match) => match[1] ?? "")
  let cleaned = (userMessages.length > 0 ? userMessages.join("\n") : raw)
    .replace(/<tool_call[\s\S]*?(?:<\/tool_call>|$)/gi, "")
    .replace(DSML_TOOL_CALL_BLOCK, "")
    .replace(/<tool_response[\s\S]*?(?:<\/tool_response>|$)/gi, "")
    .replace(/<tool_result[\s\S]*?(?:<\/tool_result>|$)/gi, "")
    .replace(/<tool[\s\S]*?(?:<\/tool>|$)/gi, "")
    .replace(/<thinking[\s\S]*?(?:<\/thinking>|$)/gi, "")
    .replace(/<thought[\s\S]*?(?:<\/thought>|$)/gi, "")
    .replace(/<system[\s\S]*?(?:<\/system>|$)/gi, "")
    .replace(/<environment[\s\S]*?(?:<\/environment>|$)/gi, "")
    .replace(/<attachments[\s\S]*?(?:<\/attachments>|$)/gi, "")
    .replace(/<\/?(?:tool_call|tool_response|tool_result|tool|thinking|thought|system|environment|user_message|attachments)>/gi, "")

  cleaned = cleaned.replace(/```(?:json|xml)?[\s\S]*?```/gi, (match) => {
    if (match.includes('"name"') || match.includes('"arguments"') || match.includes("<tool_call")) {
      return ""
    }
    return match
  })

  cleaned = cleaned
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim()
      if (trimmed.startsWith("{") && (trimmed.includes('"name"') || trimmed.includes('"arguments"'))) return false
      return true
    })
    .join("\n")

  return cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim()
}

export const cleanTitle = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined
  let line = raw
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!line) return undefined

  line = line
    .replace(/^#+\s*/, "")
    .replace(/^[-*•]\s*/, "")
    .replace(/^["'`“‘]+/, "")
    .replace(/["'`”’]+$/, "")
    .trim()

  if (
    line.includes("<tool_call") ||
    line.includes("</tool_call>") ||
    line.includes("<tool_response") ||
    line.includes("</tool_response>") ||
    line.includes("<tool_result") ||
    line.includes("</tool_result>") ||
    line.includes("<thinking") ||
    line.includes("</thinking>") ||
    DSML_TOOL_CALL.test(line)
  ) {
    return undefined
  }

  if (/^<[A-Za-z_-]+[\s\S]*>.*<\/[A-Za-z_-]+>$/.test(line) || /^<[A-Za-z_-]+[\s\S]*>$/.test(line)) {
    return undefined
  }

  if (line.startsWith("{") && line.endsWith("}")) {
    return undefined
  }
  if (line.includes('"name":') && line.includes('"arguments":')) {
    return undefined
  }
  if (line.includes('"query":') && /^\s*\{/.test(line)) {
    return undefined
  }

  line = line.trim()
  if (!line) return undefined

  return truncate(line)
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const llm = yield* LLMClient.Service
    const context = yield* SessionContext.Service
    const store = yield* SessionStore.Service
    const db = (yield* Database.Service).db

    const attempt = Effect.fn("SessionTitle.attempt")(function* (input: {
      readonly session: SessionSchema.Info
      readonly agent: Agent.Info
      readonly text: string
      readonly model: SessionRunnerModel.Resolved
    }) {
      const chunks: string[] = []
      let failed = false
      let usage: SessionUsage.Recorded | undefined
      const recordUsage = Effect.suspend(() =>
        usage
          ? bus.publish(SessionEvent.UsageRecorded, {
              sessionID: input.session.id,
              source: "title",
              ...usage,
            })
          : Effect.void,
      )
      const prepared = yield* context.request.title({
        session: input.session,
        agent: input.agent.id,
        model: input.model,
        system: input.agent.system ? [SystemPart.make(input.agent.system)] : [],
        messages: [Message.user(input.text)],
      })
      if (prepared.event.result !== undefined) return prepared.event.result
      yield* llm.stream(prepared.request, prepared.options).pipe(
        Stream.runForEach((event) => {
          if (LLMEvent.is.providerError(event)) failed = true
          if (LLMEvent.is.textDelta(event)) chunks.push(event.text)
          if (LLMEvent.is.stepFinish(event)) {
            const step = SessionUsage.record(event.usage, input.model.cost)
            usage = usage ? SessionUsage.add(usage, step) : step
          }
          return Effect.void
        }),
        Effect.catchTag("AI.Error", () =>
          Effect.sync(() => {
            failed = true
          }),
        ),
        Effect.onInterrupt(() => recordUsage.pipe(Effect.asVoid)),
      )
      yield* recordUsage
      if (failed) return
      return chunks
        .join("")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
    })

    const generate = Effect.fn("SessionTitle.generate")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return
      const firstUser = yield* SessionHistory.firstUserMessage(db, session.id)
      if (!firstUser) return
      const userQuery = cleanMessageText(firstUser.text) || firstUser.text.trim()
      const text = !isUntitled(session)
        ? yield* store.context(session.id).pipe(
            Effect.map((messages) => {
              const original = `Original request:\n${userQuery.slice(0, MAX_FIRST_MESSAGE_LENGTH)}`
              const recent = messages
                .flatMap((message) => {
                  if (message.type === "user" && message.id !== firstUser.id) {
                    const cleaned = cleanMessageText(message.text)
                    return cleaned ? [`User: ${cleaned}`] : []
                  }
                  if (message.type !== "assistant") return []
                  const text = message.content
                    .flatMap((part) => (part.type === "text" ? [cleanMessageText(part.text)] : []))
                    .filter(Boolean)
                    .join("\n")
                  return text ? [`Assistant: ${text}`] : []
                })
                .join("\n\n")
              if (!recent) return original
              const prefix = `${original}\n\nRecent conversation:\n`
              const budget = Math.max(0, MAX_CONTEXT_LENGTH - prefix.length)
              return `${prefix}${budget > 0 ? recent.slice(-budget) : ""}`
            }),
            Effect.orElseSucceed(() => userQuery),
          )
        : userQuery
      const selection = yield* context.selectTitle(session)
      if (!selection) return
      const rawTitle =
        (yield* attempt({ session, agent: selection.agent, text, model: selection.selected })) ??
        (selection.primary && !isDeepStrictEqual(selection.selected.ref, selection.primary.ref)
          ? yield* attempt({ session, agent: selection.agent, text, model: selection.primary })
          : undefined)
      let title: string | undefined
      if (!rawTitle) {
        if (!isUntitled(session)) return
        const fallback = cleanTitle(userQuery) ?? userQuery.split("\n")[0]?.trim()
        if (fallback) title = truncate(fallback)
      } else {
        title = cleanTitle(rawTitle)
        if (!title && isUntitled(session)) {
          const fallback = cleanTitle(userQuery) ?? userQuery.split("\n")[0]?.trim()
          if (fallback) title = truncate(fallback)
        }
      }
      if (!title) return
      const expectedSequence = (yield* Bus.latestSequence(db, sessionID)) + 1
      const current = yield* store.get(sessionID)
      if (!current || current.title !== session.title || current.title === title) return
      if (!isUntitled(current) && rawTitle && !cleanTitle(rawTitle)) return
      yield* bus
        .publish(
          SessionEvent.Renamed,
          {
            sessionID: session.id,
            title,
          },
          { commit: (sequence) => (sequence === expectedSequence ? Effect.void : Effect.die(titleChanged)) },
        )
        .pipe(Effect.catchDefect((defect) => (defect === titleChanged ? Effect.void : Effect.die(defect))))
    })
    return Service.of({ generate })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node, llmClient, SessionContext.node, SessionStore.node, Database.node],
})
