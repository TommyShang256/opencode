import { describe, expect, test } from "bun:test"
import { parseStandaloneServerOptions } from "../src/standalone-options"

describe("standalone server options", () => {
  test("parses network options without CLI commands", () => {
    expect(
      parseStandaloneServerOptions([
        "--hostname",
        "0.0.0.0",
        "--port",
        "4096",
        "--cors",
        "https://one.example",
        "--cors",
        "https://two.example",
      ]),
    ).toEqual({
      hostname: "0.0.0.0",
      port: 4096,
      cors: ["https://one.example", "https://two.example"],
    })
  })

  test("validates port", () => {
    expect(() => parseStandaloneServerOptions(["--port", "not-a-port"])).toThrow("port must be an integer")
    expect(() => parseStandaloneServerOptions(["--port", "70000"])).toThrow("port must be between")
  })

  test("supports help", () => {
    expect(parseStandaloneServerOptions(["--help"])).toEqual({ help: true })
  })
})
