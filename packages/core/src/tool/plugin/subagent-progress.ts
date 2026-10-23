export * as SubagentProgress from "./subagent-progress.js"

import { DateTime } from "effect"

/** Tool inputs that name what a step works on, in priority order. */
const DETAIL_KEYS = [
  "path",
  "filePath",
  "applicationPath",
  "sourcePath",
  "draftPath",
  "pattern",
  "id",
  "query",
  "scenario",
  "command",
] as const
const DETAIL_LIMIT = 160
const ACTIVITY_LIMIT = 8
const ACTIVE_TOOL = new Set(["streaming", "running", "waiting-client"])

type Millis = DateTime.Utc | number
type Part =
  | { type: "text"; text: string }
  | { type: "reasoning"; time?: { created: Millis; completed?: Millis } }
  | {
      type: "tool"
      name: string
      state: { status: string; input: unknown; error?: { message: string } }
      time: { created: Millis; completed?: Millis }
    }
type Message = { type: string; content?: ReadonlyArray<unknown>; time: { created: Millis; completed?: Millis } }

export type Activity =
  | { kind: "tool"; label: string; status: string; detail?: string; error?: string }
  | { kind: "text"; label: string; status: "completed" }
/** What the child is doing right now; `since` is when that started, in epoch milliseconds. */
export type Current = { kind: "thinking" | "tool" | "text"; since: number; label?: string; detail?: string }
export type Snapshot = { stepCount: number; current: Current; activities: Activity[] }

const millis = (value: Millis) => (typeof value === "number" ? value : DateTime.toEpochMillis(value))
const clip = (value: string) => {
  const line = value.trim().split("\n")[0] ?? ""
  return line.length > DETAIL_LIMIT ? `${line.slice(0, DETAIL_LIMIT - 1)}…` : line
}

/** The object a step works on, read from complete input or from input still streaming as JSON text. */
export function detail(input: unknown): string | undefined {
  for (const key of DETAIL_KEYS) {
    const value =
      typeof input === "string"
        ? input.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`))?.[1]
        : input !== null && typeof input === "object"
          ? (input as Record<string, unknown>)[key]
          : undefined
    if (typeof value === "string" && value.trim()) return clip(value)
  }
  return undefined
}

function activity(part: Part): Activity | undefined {
  if (part.type === "text")
    return part.text.trim() ? { kind: "text", label: part.text.trim().slice(0, 240), status: "completed" } : undefined
  if (part.type !== "tool") return undefined
  const what = detail(part.state.input)
  return {
    kind: "tool",
    label: part.name,
    status: part.state.status,
    ...(what ? { detail: what } : {}),
    ...(part.state.status === "error" && part.state.error ? { error: clip(part.state.error.message) } : {}),
  }
}

function current(last: Message | undefined, startedAt: number): Current {
  if (!last) return { kind: "thinking", since: startedAt }
  if (last.time.completed !== undefined) return { kind: "thinking", since: millis(last.time.completed) }
  const part = (last.content ?? []).at(-1) as Part | undefined
  if (!part) return { kind: "thinking", since: millis(last.time.created) }
  if (part.type === "tool") {
    if (!ACTIVE_TOOL.has(part.state.status))
      return { kind: "thinking", since: millis(part.time.completed ?? part.time.created) }
    const what = detail(part.state.input)
    return { kind: "tool", since: millis(part.time.created), label: part.name, ...(what ? { detail: what } : {}) }
  }
  if (part.type === "reasoning")
    return part.time?.completed !== undefined
      ? { kind: "thinking", since: millis(part.time.completed) }
      : { kind: "thinking", since: millis(part.time?.created ?? last.time.created) }
  return { kind: "text", since: millis(last.time.created) }
}

/** Summarizes a child session, oldest message first, for the parent's live progress card. */
export function snapshot(messages: ReadonlyArray<Message>, startedAt: number): Snapshot {
  const assistant = messages.filter((message) => message.type === "assistant")
  const parts = assistant.flatMap((message) => (message.content ?? []) as Part[])
  return {
    stepCount: parts.filter((part) => part.type === "tool" && ["completed", "error"].includes(part.state.status))
      .length,
    current: current(assistant.at(-1), startedAt),
    activities: parts.flatMap((part) => activity(part) ?? []).slice(-ACTIVITY_LIMIT),
  }
}
