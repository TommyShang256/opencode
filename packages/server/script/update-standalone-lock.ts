#!/usr/bin/env bun

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { stageStandaloneWorkspace } from "./standalone-workspace"

const root = path.resolve(import.meta.dirname, "../../..")
const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-server-lock-")))
try {
  await stageStandaloneWorkspace(root, directory, { lockfile: false })
  const command = [
    process.execPath,
    "install",
    "--lockfile-only",
    "--ignore-scripts",
    "--concurrent-scripts=1",
    "--network-concurrency=8",
    ...(process.env.OPENCODE_BUILD_REGISTRY ? [`--registry=${process.env.OPENCODE_BUILD_REGISTRY}`] : []),
    `--linker=${process.env.OPENCODE_BUILD_LINKER ?? "hoisted"}`,
  ]
  console.log(`$ ${command.join(" ")}`)
  const child = Bun.spawn(command, {
    cwd: directory,
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`Command failed with exit code ${exitCode}: ${command.join(" ")}`)
  await fs.copyFile(path.join(directory, "bun.lock"), path.join(root, "packages/server/bun.standalone.lock"))
  console.log("updated packages/server/bun.standalone.lock")
} finally {
  await fs.rm(directory, { recursive: true, force: true })
}
