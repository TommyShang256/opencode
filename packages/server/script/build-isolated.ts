#!/usr/bin/env bun

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { stageStandaloneWorkspace } from "./standalone-workspace"

const source = path.resolve(import.meta.dirname, "../../..")
const args = process.argv.slice(2)
const verbose = process.env.OPENCODE_BUILD_VERBOSE === "1"
const registry = value("registry") ?? process.env.OPENCODE_BUILD_REGISTRY
const linker = value("linker") ?? process.env.OPENCODE_BUILD_LINKER
if (linker !== undefined && linker !== "isolated" && linker !== "hoisted") {
  throw new Error("--linker must be isolated or hoisted")
}
const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-server-source-")))
try {
  console.log(`staging isolated server workspace at ${directory}`)
  await stageStandaloneWorkspace(source, directory, { lockfile: true })
  await run(
    [
      process.execPath,
      "install",
      "--frozen-lockfile",
      "--concurrent-scripts=1",
      "--network-concurrency=8",
      ...(args.includes("--ignore-scripts") ? ["--ignore-scripts"] : []),
      ...(registry ? [`--registry=${registry}`] : []),
      ...(linker ? [`--linker=${linker}`] : []),
      ...(verbose ? ["--verbose"] : []),
    ],
    directory,
  )

  const channel = process.env.OPENCODE_CHANNEL ?? (await git("branch", "--show-current")) ?? "dataagent-v2"
  const revision = (await git("rev-parse", "--short=12", "HEAD")) ?? "archive"
  const environment = {
    ...process.env,
    OPENCODE_CHANNEL: channel,
    OPENCODE_VERSION: process.env.OPENCODE_VERSION ?? `0.0.0-${channel.replace(/[^a-zA-Z0-9._-]/g, "-")}-${revision}`,
  }
  await run(
    [process.execPath, "--smol", "./packages/server/script/build-standalone.ts", ...normalizePaths(args)],
    directory,
    environment,
  )

  const built = path.join(directory, "packages/server/dist")
  const destination = path.join(source, "packages/server/dist")
  const staged = path.join(source, "packages/server", `.dist-${process.pid}`)
  await fs.rm(staged, { recursive: true, force: true })
  await fs.cp(built, staged, { recursive: true })
  await fs.rm(destination, { recursive: true, force: true })
  await fs.rename(staged, destination)
  console.log(`installed isolated server artifacts into ${destination}`)
} finally {
  await fs.rm(directory, { recursive: true, force: true })
}

function value(name: string) {
  const exact = `--${name}`
  const prefix = `${exact}=`
  const index = args.findIndex((argument) => argument === exact || argument.startsWith(prefix))
  if (index === -1) return undefined
  return args[index] === exact ? args[index + 1] : args[index]!.slice(prefix.length)
}

function normalizePaths(input: string[]) {
  const names = new Set(["runtime-cache", "node-runtime", "python-runtime"])
  const result: string[] = []
  for (let index = 0; index < input.length; index++) {
    const argument = input[index]!
    const pair = argument.match(/^--([^=]+)=(.*)$/)
    if (pair && names.has(pair[1]!)) {
      result.push(`--${pair[1]}=${path.resolve(source, pair[2]!)}`)
      continue
    }
    const name = argument.startsWith("--") ? argument.slice(2) : ""
    if (names.has(name) && input[index + 1]) {
      result.push(argument, path.resolve(source, input[++index]!))
      continue
    }
    result.push(argument)
  }
  return result
}

async function git(...command: string[]) {
  const process = Bun.spawn(["git", "-C", source, ...command], { stdout: "pipe", stderr: "ignore" })
  const output = await new Response(process.stdout).text()
  return (await process.exited) === 0 && output.trim() ? output.trim() : undefined
}

async function run(command: string[], cwd: string, env: Record<string, string | undefined> = process.env) {
  console.log(`$ ${command.join(" ")}`)
  const child = Bun.spawn(command, { cwd, env, stdin: "inherit", stdout: "inherit", stderr: "inherit" })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`Command failed with exit code ${exitCode}: ${command.join(" ")}`)
}
