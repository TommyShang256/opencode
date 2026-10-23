import { describe, expect, test } from "bun:test"
import { SubagentProgress } from "@opencode/core/tool/plugin/subagent-progress"

const tool = (name: string, status: string, input: unknown, created: number, extra: Record<string, unknown> = {}) => ({
  type: "tool",
  name,
  state: { status, input, ...extra },
  time: { created, ...(status === "completed" || status === "error" ? { completed: created + 5 } : {}) },
})
const assistant = (created: number, content: unknown[], completed?: number) => ({
  type: "assistant",
  content,
  time: { created, ...(completed === undefined ? {} : { completed }) },
})

describe("SubagentProgress.snapshot", () => {
  test("names what each step works on and counts settled steps", () => {
    const result = SubagentProgress.snapshot(
      [
        { type: "user", time: { created: 1 } },
        assistant(
          10,
          [
            { type: "text", text: "Loading the design skill." },
            tool("skill", "completed", { id: "data-solution-design" }, 11),
            tool("read", "completed", { path: "apps/x/01-specification/analysis-spec.json", limit: 10 }, 12),
            tool("glob", "error", { pattern: "**/schema.json" }, 13, { error: { type: "x", message: "denied\nstack" } }),
          ],
          20,
        ),
      ],
      0,
    )
    expect(result.stepCount).toBe(3)
    expect(result.activities).toEqual([
      { kind: "text", label: "Loading the design skill.", status: "completed" },
      { kind: "tool", label: "skill", status: "completed", detail: "data-solution-design" },
      { kind: "tool", label: "read", status: "completed", detail: "apps/x/01-specification/analysis-spec.json" },
      { kind: "tool", label: "glob", status: "error", detail: "**/schema.json", error: "denied" },
    ])
    // Between steps the model is thinking about the next one.
    expect(result.current).toEqual({ kind: "thinking", since: 20 })
  })

  test("reports an unfinished thought, a running tool and streaming input", () => {
    expect(SubagentProgress.snapshot([], 7).current).toEqual({ kind: "thinking", since: 7 })
    expect(SubagentProgress.snapshot([assistant(30, [])], 0).current).toEqual({ kind: "thinking", since: 30 })
    expect(
      SubagentProgress.snapshot([assistant(30, [{ type: "reasoning", text: "secret", time: { created: 35 } }])], 0),
    ).toEqual({ stepCount: 0, current: { kind: "thinking", since: 35 }, activities: [] })
    expect(
      SubagentProgress.snapshot([assistant(30, [tool("write", "streaming", '{"path":"apps/x/design.json","content":"{', 40)])], 0)
        .current,
    ).toEqual({ kind: "tool", since: 40, label: "write", detail: "apps/x/design.json" })
  })

  test("keeps the latest activities and a short detail", () => {
    const tools = Array.from({ length: 12 }, (_, index) => tool("read", "completed", { path: `f${index}` }, index))
    const result = SubagentProgress.snapshot([assistant(1, tools, 50)], 0)
    expect(result.activities.map((item) => (item.kind === "tool" ? item.detail : ""))).toEqual(
      ["f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11"],
    )
    expect(SubagentProgress.detail({ command: `${"x".repeat(200)}\nsecond line` })).toHaveLength(160)
    expect(SubagentProgress.detail({ content: "no target" })).toBeUndefined()
  })
})
