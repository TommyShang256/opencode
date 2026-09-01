import { describe, expect, test } from "bun:test"
import { workspacePackages } from "../script/standalone-workspace"

const root = new URL("../../..", import.meta.url)

describe("standalone server build", () => {
  test("is owned by the server package", async () => {
    const pkg = await Bun.file(new URL("package.json", root)).json()

    expect(pkg.scripts["build:server"]).toBe("bun --smol packages/server/script/build-standalone.ts")
  })

  test("bootstraps only the server dependency graph", async () => {
    const source = await Bun.file(new URL("../script/build-standalone.ts", import.meta.url)).text()
    const imports = new Bun.Transpiler({ loader: "ts" })
      .scanImports(source.replace(/^#![^\n]*\n/, ""))
      .filter((item) => item.kind === "import-statement")
      .map((item) => item.path)

    expect(imports.filter((item) => item.startsWith("@opencode-ai/"))).toEqual([])
    expect(source).toContain('"./packages/server/script/build-isolated.ts"')
    expect(source).not.toContain('"--filter=@opencode-ai/server"')
    expect(source).not.toContain("@opencode-ai/cli")
    expect(source).toContain('"./packages/server/src/main.ts"')
  })

  test("uses a frozen server-only lockfile that cannot resolve app Git dependencies", async () => {
    const lock = await Bun.file(new URL("../bun.standalone.lock", import.meta.url)).text()
    const workspaces: readonly string[] = workspacePackages

    expect(lock).not.toContain("ghostty-web")
    expect(lock).not.toContain('"@opencode-ai/cli"')
    expect(lock).not.toContain('"@opencode-ai/tui"')
    expect(lock).not.toContain("packages/app")
    expect(workspaces).toContain("packages/server")
    expect(workspaces).not.toContain("packages/app")
    expect(workspaces).not.toContain("packages/cli")
    expect(workspaces).not.toContain("packages/tui")
  })

  test("keeps the Huawei build command and legacy artifact names", async () => {
    const source = await Bun.file(new URL("../../../huawei_build/build_v1.sh", import.meta.url)).text()

    expect(source).toContain('"$BUN_EXEC" --smol packages/server/script/build-standalone.ts')
    expect(source).not.toContain("--npm-install")
    expect(source).toContain("OPENCODE_CHANNEL=next")
    expect(source).toContain('OPENCODE_VERSION="0.0.0-next-$revision"')
    expect(source).toContain("packages/server/dist/cubecode-server")
    expect(source).toContain("packages/server/dist/cubecode2-server.tar.gz")
    expect(source).toContain('mv "$staging/bin/opencode2-server" "$staging/bin/cubecode-server"')
  })

  test("uses the same Bun frozen install for Huawei and general builds", async () => {
    const source = await Bun.file(new URL("../script/build-isolated.ts", import.meta.url)).text()

    expect(source).toContain("stageStandaloneWorkspace(source, directory, { lockfile: true })")
    expect(source).toContain('"--frozen-lockfile"')
    expect(source).toContain('...(verbose ? ["--verbose"] : [])')
    expect(source).not.toContain("npm install")
  })
})
