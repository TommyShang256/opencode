#!/usr/bin/env bun

import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import { createRequire } from "node:module"
import { createServer } from "node:net"
import os from "node:os"
import path from "node:path"
import { parseArgs } from "node:util"
import type { BunPlugin } from "bun"

const root = path.resolve(import.meta.dirname, "../../..")
const options = parseArgs({
  args: process.argv.slice(2),
  strict: true,
  allowPositionals: false,
  options: {
    install: { type: "boolean", default: false },
    registry: { type: "string" },
    linker: { type: "string" },
    "ignore-scripts": { type: "boolean", default: false },
    baseline: { type: "boolean", default: false },
    "package-runtime": { type: "boolean", default: false },
    "runtime-cache": { type: "string" },
    "node-runtime": { type: "string" },
    "python-runtime": { type: "string" },
  },
}).values

const registry = options.registry ?? process.env.OPENCODE_BUILD_REGISTRY
const linker = options.linker ?? process.env.OPENCODE_BUILD_LINKER
if (linker !== undefined && linker !== "isolated" && linker !== "hoisted") {
  throw new Error("--linker must be isolated or hoisted")
}

if (options.install) {
  await run([
    process.execPath,
    "--smol",
    "./packages/server/script/build-isolated.ts",
    ...process.argv.slice(2).filter((argument) => argument !== "--install"),
  ])
  process.exit(0)
}

const { Script } = await import("@opencode/script")
const target = currentTarget(Boolean(options.baseline))
const output = path.join(root, "packages/server/dist", target.name)
const executable = path.join(output, "bin", `opencode2-server${target.os === "windows" ? ".exe" : ""}`)
await fs.rm(output, { recursive: true, force: true })

const pty = await resolveOpencodePty(target)
const ptyPlugin: BunPlugin = {
  name: "opencode-pty-binary",
  setup(build) {
    build.onLoad({ filter: /persistent-pty[/\\]pty-binding\.ts$/ }, () => ({
      loader: "js",
      contents: pty
        ? `import file from ${JSON.stringify(pty.source)} with { type: "file" }
export default { path: file, version: ${JSON.stringify(pty.version)}, sha256: ${JSON.stringify(pty.sha256)} }`
        : "export default undefined",
    }))
  },
}
const parcelWatcher = `@parcel/watcher-${target.platform}-${target.arch}${target.platform === "linux" ? `-${target.libc}` : ""}`
const parcelWatcherPlugin: BunPlugin = {
  name: "parcel-watcher-binding",
  setup(build) {
    build.onLoad({ filter: /filesystem[/\\]watcher-binding\.ts$/ }, () => ({
      loader: "js",
      contents: `export default () => require(${JSON.stringify(parcelWatcher)})`,
    }))
  },
}

console.log(`building ${target.name} from packages/server`)
const result = await Bun.build({
  entrypoints: ["./packages/server/src/main.ts"],
  tsconfig: "./packages/server/tsconfig.json",
  plugins: [parcelWatcherPlugin, ptyPlugin],
  external: ["node-gyp"],
  format: "esm",
  minify: true,
  sourcemap: Script.channel === "dev" || Script.channel === "local" ? "inline" : "none",
  splitting: true,
  compile: {
    autoloadBunfig: false,
    autoloadDotenv: false,
    autoloadTsconfig: true,
    autoloadPackageJson: true,
    target: target.compile,
    outfile: executable,
    execArgv: [`--user-agent=opencode2-server/${Script.version}`, "--use-system-ca", "--no-warnings", "--"],
    windows: {},
  },
  define: {
    OPENCODE_VERSION: JSON.stringify(Script.version),
    OPENCODE_CLI_NAME: JSON.stringify("opencode2-server"),
    OPENCODE_CHANNEL: JSON.stringify(Script.channel),
    OPENCODE_LIBC: target.platform === "linux" ? JSON.stringify(target.libc) : "undefined",
    FFF_LIBC: target.platform === "linux" ? JSON.stringify(target.libc === "musl" ? "musl" : "gnu") : "undefined",
  },
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

await Bun.write(
  path.join(output, "package.json"),
  JSON.stringify(
    {
      name: "@opencode-ai/server-standalone",
      version: Script.version,
      private: true,
      os: [target.platform],
      cpu: [target.arch],
    },
    null,
    2,
  ),
)
await verify(executable, Script.version)
if (options["package-runtime"]) await packageRuntime(executable, target.name)

type Target = {
  readonly platform: NodeJS.Platform
  readonly os: string
  readonly arch: "arm64" | "x64"
  readonly libc: "glibc" | "musl"
  readonly name: string
  readonly compile: Bun.Build.CompileTarget
}

function currentTarget(baseline: boolean): Target {
  if (process.arch !== "arm64" && process.arch !== "x64") {
    throw new Error(`Unsupported server architecture: ${process.arch}`)
  }
  if (process.platform !== "linux" && process.platform !== "darwin" && process.platform !== "win32") {
    throw new Error(`Unsupported server platform: ${process.platform}`)
  }
  const platform = process.platform
  const osName = platform === "win32" ? "windows" : platform
  const libc = platform === "linux" && !process.report.getReport().header.glibcVersionRuntime ? "musl" : "glibc"
  const suffix = [
    osName,
    process.arch,
    baseline ? "baseline" : undefined,
    platform === "linux" && libc === "musl" ? libc : undefined,
  ]
    .filter(Boolean)
    .join("-")
  return {
    platform,
    os: osName,
    arch: process.arch,
    libc,
    name: `server-${suffix}`,
    compile: `bun-${suffix}` as Bun.Build.CompileTarget,
  }
}

async function run(command: string[]) {
  console.log(`$ ${command.join(" ")}`)
  const child = Bun.spawn(command, {
    cwd: root,
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`Command failed with exit code ${exitCode}: ${command.join(" ")}`)
}

async function resolveOpencodePty(target: Target) {
  if (target.platform === "win32") return undefined
  const core = createRequire(path.join(root, "packages/core/package.json"))
  const pty = createRequire(core.resolve("@opencode-ai/pty/package.json"))
  const suffix = [
    target.platform,
    target.arch,
    target.platform === "linux" ? (target.libc === "glibc" ? "gnu" : "musl") : undefined,
  ]
    .filter(Boolean)
    .join("-")
  const name = `@opencode-ai/pty-${suffix}`
  const local = process.env.OPENCODE_PTY_BIN
  const source = local ? path.resolve(local) : pty.resolve(`${name}/bin/opencode-pty`)
  const manifest: unknown = local
    ? { version: "local" }
    : JSON.parse(await fs.readFile(pty.resolve(`${name}/package.json`), "utf8"))
  if (!manifest || typeof manifest !== "object" || !("version" in manifest) || typeof manifest.version !== "string") {
    throw new Error(`Invalid package metadata for ${name}`)
  }
  return {
    source,
    version: manifest.version,
    sha256: createHash("sha256")
      .update(await fs.readFile(source))
      .digest("hex"),
  }
}

async function verify(source: string, version: string) {
  if (!(await Bun.file(source).exists())) throw new Error(`Missing server artifact: ${source}`)
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-server-build-")))
  const copy = path.join(directory, path.basename(source))
  const password = randomBytes(24).toString("base64url")
  const port = await availablePort()
  await fs.copyFile(source, copy)
  await fs.chmod(copy, 0o755)

  const child = Bun.spawn([copy, "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: directory,
    env: {
      ...process.env,
      HOME: directory,
      USERPROFILE: directory,
      XDG_CACHE_HOME: path.join(directory, "cache"),
      XDG_CONFIG_HOME: path.join(directory, "config"),
      XDG_DATA_HOME: path.join(directory, "data"),
      XDG_STATE_HOME: path.join(directory, "state"),
      OPENCODE_APP_NAME: "dataagent-build-check",
      OPENCODE_CONFIG_PROJECT_DISABLE: "1",
      OPENCODE_DB: path.join(directory, "opencode.db"),
      OPENCODE_DISABLE_MODELS_FETCH: "1",
      OPENCODE_LOG_PREFIX: "dataagent-build-check",
      OPENCODE_PASSWORD: password,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = new Response(child.stdout).text()
  const stderr = new Response(child.stderr).text()
  let failure: unknown
  try {
    const url = new URL(`http://127.0.0.1:${port}/api/info`)
    const response = await waitForHealth(url, password)
    const body: unknown = await response.json()
    if (
      typeof body !== "object" ||
      body === null ||
      !("version" in body) ||
      body.version !== version
    ) {
      throw new Error(`Unexpected health response: ${JSON.stringify(body)}`)
    }
    const unauthorized = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    if (unauthorized.status !== 401) throw new Error(`Unauthenticated health returned ${unauthorized.status}`)
    console.log(`verified ${source} via ${url}`)
  } catch (cause) {
    failure = cause
  } finally {
    child.kill()
    await child.exited
    await fs.rm(directory, { recursive: true, force: true })
  }
  if (failure) {
    throw new Error([await stdout, await stderr].filter(Boolean).join("\n") || "Server artifact verification failed", {
      cause: failure,
    })
  }
}

async function waitForHealth(url: URL, password: string) {
  const authorization = `Basic ${btoa(`opencode:${password}`)}`
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const response = await fetch(url, {
      headers: { authorization },
      signal: AbortSignal.timeout(1_000),
    }).catch(() => undefined)
    if (response?.ok) return response
    await Bun.sleep(50)
  }
  throw new Error(`Server artifact did not become healthy at ${url}`)
}

async function availablePort() {
  const server = createServer()
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") return reject(new Error("Unable to allocate a test port"))
      resolve(address.port)
    })
  })
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  return port
}

async function packageRuntime(source: string, target: string) {
  if (process.platform === "win32") throw new Error("--package-runtime currently supports Unix build hosts only")
  const cache = path.resolve(
    root,
    options["runtime-cache"] ?? process.env.OPENCODE_BUILD_RUNTIME_CACHE ?? "../runtime-cache",
  )
  const node = await resolveRuntime(options["node-runtime"] ?? process.env.OPENCODE_BUILD_NODE_RUNTIME, cache, "node", [
    "bin/node",
  ])
  const python = await resolveRuntime(
    options["python-runtime"] ?? process.env.OPENCODE_BUILD_PYTHON_RUNTIME,
    cache,
    "python",
    ["bin/python3", "bin/python"],
  )
  const output = path.join(path.dirname(path.dirname(source)), "opencode2-server-runtime.tar.gz")
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-server-runtime-")))
  const bundle = path.join(directory, "bundle")
  try {
    await fs.mkdir(path.join(bundle, "bin"), { recursive: true })
    await fs.mkdir(path.join(bundle, "runtime"), { recursive: true })
    await fs.copyFile(source, path.join(bundle, "bin", path.basename(source)))
    await fs.chmod(path.join(bundle, "bin", path.basename(source)), 0o755)
    await fs.cp(node, path.join(bundle, "runtime", "node"), { recursive: true, dereference: false })
    await fs.cp(python, path.join(bundle, "runtime", "python"), { recursive: true, dereference: false })
    await fs.writeFile(
      path.join(bundle, "setup.sh"),
      `#!/usr/bin/env sh
set -eu
BUNDLE_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
export PATH="$BUNDLE_DIR/runtime/node/bin:$BUNDLE_DIR/runtime/python/bin:$PATH"
export LD_LIBRARY_PATH="$BUNDLE_DIR/runtime/python/lib\${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
if [ "$#" -gt 0 ]; then exec "$@"; fi
`,
      { mode: 0o755 },
    )
    await run(["tar", "czf", output, "-C", bundle, "."])
    const stat = await fs.stat(output)
    if (stat.size === 0) throw new Error(`Empty runtime package: ${output}`)
    console.log(`packaged ${target} with Node.js and Python runtimes: ${output}`)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

async function resolveRuntime(configured: string | undefined, cache: string, name: string, executables: string[]) {
  const candidates = configured
    ? [path.resolve(root, configured)]
    : await fs
        .readdir(cache, { withFileTypes: true })
        .then((entries) =>
          entries
            .filter((entry) => entry.isDirectory() && (entry.name === name || entry.name.startsWith(`${name}-`)))
            .map((entry) => path.join(cache, entry.name))
            .sort()
            .reverse(),
        )
        .catch(() => [])
  for (const candidate of candidates) {
    for (const executable of executables) {
      if (await Bun.file(path.join(candidate, executable)).exists()) return candidate
    }
  }
  throw new Error(`Missing ${name} runtime under ${configured ? path.resolve(root, configured) : cache}`)
}
