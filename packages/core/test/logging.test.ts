import { describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "@opencode-ai/util/global"
import { Logging } from "@opencode-ai/util/observability/logging"

describe("Logging", () => {
  test("uses a local-specific log file for local installs", () => {
    expect(Logging.file(true, "local")).toBe(path.join(Global.Path.log, "opencode-local.log"))
  })

  test("keeps non-local installs on the default log file", () => {
    expect(Logging.file(false, "next")).toBe(path.join(Global.Path.log, "opencode.log"))
  })

  test("supports a distribution-specific log prefix", () => {
    const previous = process.env.OPENCODE_LOG_PREFIX
    process.env.OPENCODE_LOG_PREFIX = "dataagent"
    try {
      expect(Logging.file(true, "next")).toBe(path.join(Global.Path.log, "dataagent-next.log"))
      expect(Logging.file(false, "next")).toBe(path.join(Global.Path.log, "dataagent.log"))
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_LOG_PREFIX
      else process.env.OPENCODE_LOG_PREFIX = previous
    }
  })
})
