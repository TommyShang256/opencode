import fs from "node:fs/promises"
import path from "node:path"

export const workspacePackages = [
  "packages/ai",
  "packages/client",
  "packages/codemode",
  "packages/core",
  "packages/httpapi-codegen",
  "packages/http-recorder",
  "packages/plugin",
  "packages/plugin-browser",
  "packages/protocol",
  "packages/schema",
  "packages/script",
  "packages/server",
  "packages/simulation",
  "packages/theme",
  "packages/util",
] as const

interface RootManifest {
  readonly $schema?: string
  readonly version?: string
  readonly type?: string
  readonly packageManager?: string
  readonly workspaces: { readonly catalog?: Record<string, string> }
  readonly trustedDependencies?: readonly string[]
  readonly overrides?: Record<string, unknown>
  readonly patchedDependencies?: Record<string, string>
}

export async function stageStandaloneWorkspace(
  source: string,
  destination: string,
  options: { readonly lockfile: boolean },
) {
  const root = (await Bun.file(path.join(source, "package.json")).json()) as RootManifest
  const manifest = {
    $schema: root.$schema,
    name: "opencode-server-build",
    version: root.version,
    private: true,
    type: root.type,
    packageManager: root.packageManager,
    scripts: { "build:server": "bun --smol packages/server/script/build-standalone.ts" },
    workspaces: { packages: [...workspacePackages], catalog: root.workspaces.catalog },
    dependencies: {},
    devDependencies: {},
    trustedDependencies: root.trustedDependencies,
    overrides: root.overrides,
    patchedDependencies: root.patchedDependencies,
  }

  await fs.mkdir(destination, { recursive: true })
  await fs.writeFile(path.join(destination, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  await copyIfPresent(path.join(source, "bunfig.toml"), path.join(destination, "bunfig.toml"))
  await copyIfPresent(path.join(source, ".github/TEAM_MEMBERS"), path.join(destination, ".github/TEAM_MEMBERS"))
  await copyIfPresent(path.join(source, "patches"), path.join(destination, "patches"), true)
  for (const workspace of workspacePackages) {
    await fs.cp(path.join(source, workspace), path.join(destination, workspace), {
      recursive: true,
      filter: (entry) => !ignored(entry),
    })
  }
  if (options.lockfile) {
    await fs.copyFile(path.join(source, "packages/server/bun.standalone.lock"), path.join(destination, "bun.lock"))
  }
}

async function copyIfPresent(source: string, destination: string, recursive = false) {
  if (!(await fs.stat(source).catch(() => undefined))) return
  await fs.mkdir(path.dirname(destination), { recursive: true })
  if (recursive) {
    await fs.cp(source, destination, { recursive: true, filter: (entry) => !ignored(entry) })
    return
  }
  await fs.copyFile(source, destination)
}

function ignored(entry: string) {
  return entry
    .split(path.sep)
    .some((part) => part === "node_modules" || part === "dist" || part === ".turbo" || part === ".git")
}
