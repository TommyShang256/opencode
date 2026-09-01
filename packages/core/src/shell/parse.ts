export * as ShellParse from "./parse.js"

import { Effect } from "effect"
import { fileURLToPath } from "url"
import os from "os"
import path from "path"
import type { Node } from "web-tree-sitter"
import { shellParserWasm } from "#shell-parser-wasm"
import { ShellSelect } from "./select.js"
import { lazy } from "../util/lazy.js"
import { Wildcard } from "../util/wildcard.js"

type Part = { type: string; text: string }
const CWD = new Set(["cd", "chdir", "popd", "pushd", "push-location", "set-location"])
const POWERSHELL_PATH_FLAGS = new Set(["-literalpath", "-path"])

export type Result = {
  commands: Array<{ resource: string; save: string }>
  directories: string[]
  deletions?: string[]
}

const ARITY: Record<string, number> = {
  cat: 1,
  cd: 1,
  chmod: 1,
  chown: 1,
  cp: 1,
  echo: 1,
  env: 1,
  export: 1,
  grep: 1,
  kill: 1,
  killall: 1,
  ln: 1,
  ls: 1,
  mkdir: 1,
  mv: 1,
  ps: 1,
  pwd: 1,
  rm: 1,
  rmdir: 1,
  sleep: 1,
  source: 1,
  tail: 1,
  touch: 1,
  unset: 1,
  which: 1,
  aws: 3,
  az: 3,
  bazel: 2,
  brew: 2,
  bun: 2,
  "bun run": 3,
  "bun x": 3,
  cargo: 2,
  "cargo add": 3,
  "cargo run": 3,
  cdk: 2,
  cf: 2,
  cmake: 2,
  composer: 2,
  consul: 2,
  "consul kv": 3,
  crictl: 2,
  deno: 2,
  "deno task": 3,
  doctl: 3,
  docker: 2,
  "docker builder": 3,
  "docker compose": 3,
  "docker container": 3,
  "docker image": 3,
  "docker network": 3,
  "docker volume": 3,
  eksctl: 2,
  "eksctl create": 3,
  firebase: 2,
  flyctl: 2,
  gcloud: 3,
  gh: 3,
  git: 2,
  "git config": 3,
  "git remote": 3,
  "git stash": 3,
  go: 2,
  gradle: 2,
  helm: 2,
  heroku: 2,
  hugo: 2,
  ip: 2,
  "ip addr": 3,
  "ip link": 3,
  "ip netns": 3,
  "ip route": 3,
  kind: 2,
  "kind create": 3,
  kubectl: 2,
  "kubectl kustomize": 3,
  "kubectl rollout": 3,
  kustomize: 2,
  make: 2,
  mc: 2,
  "mc admin": 3,
  minikube: 2,
  mongosh: 2,
  mysql: 2,
  mvn: 2,
  ng: 2,
  npm: 2,
  "npm exec": 3,
  "npm init": 3,
  "npm run": 3,
  "npm view": 3,
  npx: 2,
  nvm: 2,
  nx: 2,
  openssl: 2,
  "openssl req": 3,
  "openssl x509": 3,
  pip: 2,
  pipenv: 2,
  pnpm: 2,
  "pnpm dlx": 3,
  "pnpm exec": 3,
  "pnpm run": 3,
  poetry: 2,
  podman: 2,
  "podman container": 3,
  "podman image": 3,
  psql: 2,
  pulumi: 2,
  "pulumi stack": 3,
  python: 2,
  pyenv: 2,
  rake: 2,
  rbenv: 2,
  "redis-cli": 2,
  rustup: 2,
  serverless: 2,
  sfdx: 3,
  skaffold: 2,
  sls: 2,
  sst: 2,
  swift: 2,
  systemctl: 2,
  terraform: 2,
  "terraform workspace": 3,
  tmux: 2,
  turbo: 2,
  ufw: 2,
  vault: 2,
  "vault auth": 3,
  "vault kv": 3,
  vercel: 2,
  volta: 2,
  wp: 2,
  yarn: 2,
  "yarn dlx": 3,
  "yarn run": 3,
}
const PREFIX_LENGTH = Math.max(...Object.values(ARITY))

export const scan = Effect.fnUntraced(function* (
  command: string,
  shell: string,
  cwd: string,
  options?: { portable?: boolean },
) {
  if (options?.portable) return yield* scanPortable(command, shell, cwd)
  return yield* scanLegacy(command, shell, cwd)
})

const scanLegacy = Effect.fnUntraced(function* (command: string, shell: string, cwd: string) {
  const parsers = yield* Effect.promise(load)
  const powershell = ShellSelect.ps(shell)
  const tree = (powershell ? parsers.ps : parsers.bash).parse(command)
  if (!tree) return yield* Effect.fail(new Error("Failed to parse shell command"))

  return yield* Effect.acquireUseRelease(
    Effect.succeed(tree),
    (tree) =>
      Effect.sync(() => {
        const result = tree.rootNode.descendantsOfType("command").reduce(
          (result, node) => {
            if (!node) return result
            const command = parts(node)
            const tokens = command.map((part) => part.text)
            if (tokens.length === 0) return result
            const name = powershell ? tokens[0].toLowerCase() : tokens[0]
            if (CWD.has(name)) {
              result.directories.push(...directoryArgs(command, powershell, cwd, shell))
              return result
            }
            const resource = (node.parent?.type === "redirected_statement" ? node.parent.text : node.text).trim()
            result.commands.push({
              resource,
              save: `${prefix(tokens).join(" ")} *`,
            })
            result.deletions.push(...deleteResources(tokens, resource, cwd))
            return result
          },
          {
            commands: [] as Array<{ resource: string; save: string }>,
            directories: [] as string[],
            deletions: [] as string[],
          },
        )
        if (result.deletions.length > 0) return result
        return { commands: result.commands, directories: result.directories }
      }),
    (tree) => Effect.sync(() => tree.delete()),
  )
})

export const scanPortable = Effect.fnUntraced(function* (command: string, shell: string, cwd: string) {
  const { ShellScan } = yield* Effect.tryPromise({
    try: () => import("./scan.js"),
    catch: (cause) => new Error(`Portable shell scanner failed to load: ${cause}`, { cause }),
  })
  const powershell = ShellSelect.ps(shell)
  const result = powershell ? ShellScan.scanPowerShell(command) : ShellScan.scan(command)
  if (result.kind === "opaque")
    return yield* Effect.fail(new Error(`Portable shell scanner cannot analyze command: ${result.reason}`))

  const output = { commands: [] as Result["commands"], directories: [] as string[], deletions: [] as string[] }
  for (const item of result.commands) {
    // The legacy command walk skips declarations, not the substitutions within them.
    if (item.declaration) continue
    const words = item.redirectWordCount === undefined ? item.rawWords : item.rawWords.slice(0, item.redirectWordCount)
    // The shipped PowerShell grammar treats bare statement-head foreach prefixes as control flow.
    if (powershell && item.statementHead && /^foreach(?:-|$)/i.test(words[0] ?? "")) continue
    const name = powershell ? words[0]?.toLowerCase() : words[0]
    if (CWD.has(name)) {
      output.directories.push(
        ...directoryArgs(
          words.flatMap((text): Part[] => {
            const parameter = powershell ? /^(-(?:literalpath|path)):(.*)$/i.exec(text) : undefined
            if (parameter)
              return [
                { type: "command_parameter", text: parameter[1] },
                { type: "word", text: parameter[2] },
              ]
            return [{ type: powershell && text.startsWith("-") ? "command_parameter" : "word", text }]
          }),
          powershell,
          cwd,
          shell,
        ),
      )
      continue
    }
    output.deletions.push(...deleteResources(item.words, item.resource, cwd))
    const selected = prefix(words.slice(0, PREFIX_LENGTH))
    const conventional = `${selected.join(" ")} *`
    const end = item.wordEnds?.[selected.length - 1]
    // Keep existing grants stable unless normalized spacing loses the original source boundary.
    const save =
      !powershell || end === undefined || Wildcard.match(item.resource, conventional)
        ? conventional
        : (() => {
            const boundary =
              item.wordEnds?.find(
                (value) => value >= end && (value >= item.resource.length || /\s/.test(item.resource[value])),
              ) ?? end
            const separator = /^\s+(?:`(?:\r\n|\r|\n)\s*)?/.exec(item.resource.slice(boundary))?.[0]
            return `${item.resource.slice(0, boundary)}${separator ?? " "}*`
          })()
    output.commands.push({
      resource: item.resource,
      save,
    })
  }
  if (output.deletions.length > 0) return output
  return { commands: output.commands, directories: output.directories }
})

const DELETE_COMMANDS = new Set(["rm", "rmdir", "unlink"])
const SHELL_COMMANDS = new Set(["sh", "bash", "dash", "zsh", "ksh"])

function deleteResources(words: ReadonlyArray<string>, resource: string, cwd: string) {
  const normalized = unwrap(words)
  const command = executable(normalized[0] ?? "")
  const redirects = truncationTargets(resource, cwd)
  if (SHELL_COMMANDS.has(command)) {
    const script = shellScript(normalized)
    return [...(script ? nestedDeleteResources(script, cwd) : []), ...redirects]
  }
  if (command === "eval")
    return [...nestedDeleteResources(normalized.slice(1).map(unquote).join(" "), cwd), ...redirects]
  if (command === "find" && hasFindDelete(normalized)) {
    const values = normalized.slice(1)
    const expression = values.findIndex((word) => unquote(word).startsWith("-"))
    const roots = values.slice(0, expression < 0 ? undefined : expression)
    return [...(roots.length > 0 ? roots : ["."]).map((word) => deletionPath(word, cwd)), ...redirects]
  }
  if (command === "git") {
    const git = gitCommand(normalized, cwd)
    if (git.command === "clean") return [git.directory, ...redirects]
    if (git.command === "rm")
      return [
        ...operands(normalized.slice(git.index + 1)).map((word) => deletionPath(word, git.directory)),
        ...redirects,
      ]
  }
  if (command === "xargs" && DELETE_COMMANDS.has(executable(xargsCommand(normalized))))
    return [path.resolve(cwd), ...redirects]
  if (command === "mv") return [...operands(normalized.slice(1)).map((word) => deletionPath(word, cwd)), ...redirects]
  if (!DELETE_COMMANDS.has(command)) return redirects
  return [...operands(normalized.slice(1)).map((word) => deletionPath(word, cwd)), ...redirects]
}

function unwrap(words: ReadonlyArray<string>): ReadonlyArray<string> {
  let result = words
  while (result.length > 0) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(unquote(result[0] ?? ""))) {
      result = result.slice(1)
      continue
    }
    const command = executable(result[0] ?? "")
    if (command === "command" || command === "builtin" || command === "nohup" || command === "busybox") {
      result = afterOptions(result.slice(1))
      continue
    }
    if (command === "env") {
      result = afterEnvironmentOptions(result.slice(1))
      continue
    }
    if (command === "sudo" || command === "doas") {
      result = afterPrivilegeOptions(result.slice(1))
      continue
    }
    return result
  }
  return result
}

function afterOptions(words: ReadonlyArray<string>) {
  let index = 0
  for (; index < words.length; index++) {
    const word = unquote(words[index] ?? "")
    if (word === "--") return words.slice(index + 1)
    if (word.startsWith("-")) continue
    break
  }
  return words.slice(index)
}

function afterEnvironmentOptions(words: ReadonlyArray<string>) {
  const optionsWithValues = new Set(["-u", "--unset", "-C", "--chdir"])
  for (let index = 0; index < words.length; index++) {
    const word = unquote(words[index] ?? "")
    if (word === "--") return words.slice(index + 1)
    if (optionsWithValues.has(word)) {
      index++
      continue
    }
    if (word.startsWith("-")) continue
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue
    return words.slice(index)
  }
  return []
}

function afterPrivilegeOptions(words: ReadonlyArray<string>) {
  const optionsWithValues = new Set([
    "-u",
    "--user",
    "-g",
    "--group",
    "-h",
    "--host",
    "-p",
    "--prompt",
    "-C",
    "--close-from",
    "-R",
    "--chroot",
    "-r",
    "--role",
    "-t",
    "--type",
    "-T",
    "--command-timeout",
  ])
  for (let index = 0; index < words.length; index++) {
    const word = unquote(words[index] ?? "")
    if (word === "--") return words.slice(index + 1)
    if (optionsWithValues.has(word)) {
      index++
      continue
    }
    if (word.startsWith("-")) continue
    return words.slice(index)
  }
  return []
}

function shellScript(words: ReadonlyArray<string>) {
  for (let index = 1; index < words.length; index++) {
    const word = unquote(words[index] ?? "")
    if (word === "--command" || /^-[^-]*c/.test(word)) return unquote(words[index + 1] ?? "")
  }
  return ""
}

function nestedDeleteResources(source: string, cwd: string) {
  return lexicalCommands(source).flatMap((words) => deleteResources(words, source, cwd))
}

function lexicalCommands(source: string) {
  const commands: string[][] = []
  let words: string[] = []
  let word = ""
  let quote: "single" | "double" | undefined
  const pushWord = () => {
    if (!word) return
    words.push(word)
    word = ""
  }
  const pushCommand = () => {
    pushWord()
    if (words.length > 0) commands.push(words)
    words = []
  }
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (quote === "single") {
      if (char === "'") quote = undefined
      else word += char
      continue
    }
    if (quote === "double") {
      if (char === "\\" && index + 1 < source.length) word += source[++index]
      else if (char === '"') quote = undefined
      else word += char
      continue
    }
    if (char === "\\" && index + 1 < source.length) {
      word += source[++index]
      continue
    }
    if (char === "'") {
      quote = "single"
      continue
    }
    if (char === '"') {
      quote = "double"
      continue
    }
    if (char === "#" && !word) {
      const newline = source.indexOf("\n", index)
      if (newline < 0) break
      pushCommand()
      index = newline
      continue
    }
    if (/\s/.test(char)) {
      pushWord()
      if (char === "\n") pushCommand()
      continue
    }
    if (char === ";" || char === "&" || char === "|" || char === "(" || char === ")") {
      pushCommand()
      continue
    }
    if (char === "<" || char === ">") {
      pushWord()
      continue
    }
    word += char
  }
  pushCommand()
  return commands
}

function gitCommand(words: ReadonlyArray<string>, cwd: string) {
  let directory = path.resolve(cwd)
  for (let index = 1; index < words.length; index++) {
    const word = unquote(words[index] ?? "")
    if (word === "-C") {
      directory = deletionPath(words[++index] ?? ".", directory)
      continue
    }
    if (word.startsWith("-C") && word.length > 2) {
      directory = deletionPath(word.slice(2), directory)
      continue
    }
    if (word.startsWith("-")) continue
    return { command: word.toLowerCase(), directory, index }
  }
  return { command: "", directory, index: words.length }
}

function hasFindDelete(words: ReadonlyArray<string>) {
  if (words.some((word) => unquote(word).toLowerCase() === "-delete")) return true
  return words.some((word, index) => {
    const current = unquote(word).toLowerCase()
    if (current !== "-exec" && current !== "-execdir") return false
    return DELETE_COMMANDS.has(executable(unwrap(words.slice(index + 1))[0] ?? ""))
  })
}

function xargsCommand(words: ReadonlyArray<string>) {
  const optionsWithValues = new Set([
    "-a",
    "--arg-file",
    "-e",
    "-E",
    "--eof",
    "-I",
    "--replace",
    "-L",
    "--max-lines",
    "-n",
    "--max-args",
    "-P",
    "--max-procs",
    "-s",
    "--max-chars",
  ])
  for (let index = 1; index < words.length; index++) {
    const word = unquote(words[index] ?? "")
    if (word === "--") return words[index + 1] ?? ""
    if (optionsWithValues.has(word)) {
      index++
      continue
    }
    if (word.startsWith("-")) continue
    return word
  }
  return ""
}

function operands(words: ReadonlyArray<string>) {
  return words.reduce(
    (result, word) => {
      if (!result.options && word === "--") return { options: true, values: result.values }
      if (!result.options && word.startsWith("-")) return result
      return { ...result, values: [...result.values, word] }
    },
    { options: false, values: [] as string[] },
  ).values
}

function executable(value: string) {
  const word = unquote(value).replaceAll("\\", "/")
  return word.slice(word.lastIndexOf("/") + 1).toLowerCase()
}

function deletionPath(value: string, cwd: string) {
  const target = unquote(value)
  if (path.isAbsolute(target)) return path.normalize(target)
  return path.resolve(cwd, target)
}

function unquote(value: string) {
  const quote = value[0]
  if ((quote === '"' || quote === "'") && value.at(-1) === quote) return value.slice(1, -1)
  return value
}

function truncationTargets(resource: string, cwd: string) {
  const targets: string[] = []
  let quote: "single" | "double" | undefined
  for (let index = 0; index < resource.length; index++) {
    const char = resource[index]
    if (quote === "single") {
      if (char === "'") quote = undefined
      continue
    }
    if (quote === "double") {
      if (char === "\\") index++
      else if (char === '"') quote = undefined
      continue
    }
    if (char === "\\") {
      index++
      continue
    }
    if (char === "'") {
      quote = "single"
      continue
    }
    if (char === '"') {
      quote = "double"
      continue
    }
    if (char === "#" && (index === 0 || /[\s;&|()]/.test(resource[index - 1] ?? ""))) {
      const newline = resource.indexOf("\n", index)
      if (newline < 0) break
      index = newline
      continue
    }
    if (char !== ">" || resource[index + 1] === ">" || resource[index - 1] === ">" || resource[index - 1] === "<")
      continue
    const descriptor = resource[index + 1] === "&"
    let cursor = index + (resource[index + 1] === "|" || descriptor ? 2 : 1)
    while (/\s/.test(resource[cursor] ?? "")) cursor++
    const target = shellToken(resource, cursor)
    if (!target.value || (descriptor && /^\d+$/.test(target.value))) continue
    targets.push(deletionPath(target.value, cwd))
    index = target.end - 1
  }
  return targets
}

function shellToken(source: string, start: number) {
  let value = ""
  let quote: "single" | "double" | undefined
  let end = start
  for (; end < source.length; end++) {
    const char = source[end]
    if (!quote && /[\s;&|()<>]/.test(char)) break
    if (quote === "single") {
      if (char === "'") quote = undefined
      else value += char
      continue
    }
    if (quote === "double") {
      if (char === "\\" && end + 1 < source.length) value += source[++end]
      else if (char === '"') quote = undefined
      else value += char
      continue
    }
    if (char === "'") quote = "single"
    else if (char === '"') quote = "double"
    else if (char === "\\" && end + 1 < source.length) value += source[++end]
    else value += char
  }
  return { value, end }
}

function parts(node: Node) {
  return Array.from({ length: node.childCount }).flatMap((_, index): Part[] => {
    const child = node.child(index)
    if (!child) return []
    if (child.type === "command_elements")
      return Array.from({ length: child.childCount }).flatMap((_, itemIndex): Part[] => {
        const item = child.child(itemIndex)
        if (!item || item.type === "command_argument_sep" || item.type === "redirection") return []
        return [{ type: item.type, text: item.text }]
      })
    if (!["command_name", "command_name_expr", "word", "string", "raw_string", "concatenation"].includes(child.type))
      return []
    return [{ type: child.type, text: child.text }]
  })
}

function directoryArgs(command: Part[], powershell: boolean, cwd: string, shell: string) {
  if (!powershell)
    return command
      .slice(1)
      .filter((part) => !part.text.startsWith("-"))
      .map((part) => directoryArgument(part.text, powershell, cwd, shell))
      .filter((part) => part !== undefined)

  const directories: string[] = []
  let path = false
  for (const part of command.slice(1)) {
    if (path) {
      const value = directoryArgument(part.text, powershell, cwd, shell)
      if (value) directories.push(value)
      path = false
      continue
    }
    if (part.type === "command_parameter") {
      path = POWERSHELL_PATH_FLAGS.has(part.text.toLowerCase())
      continue
    }
    const value = directoryArgument(part.text, powershell, cwd, shell)
    if (value) directories.push(value)
  }
  return directories
}

function directoryArgument(value: string, powershell: boolean, cwd: string, shell: string) {
  const quote = value[0]
  const text = (quote === '"' || quote === "'") && value.at(-1) === quote ? value.slice(1, -1) : value
  if (!powershell) return expandKnownDirectory(text)

  // PowerShell exposes environment variables through $env:NAME and provides these
  // automatic directory variables. Expand only values we can determine without executing code.
  return expandKnownDirectory(
    text
      .replace(/\$\{env:([^}]+)\}/gi, (_, key: string) => environment(key) ?? "")
      .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (_, key: string) => environment(key) ?? "")
      .replace(/\$(HOME|PWD|PSHOME)(?=$|[\\/])/gi, (_, key: string) => {
        if (key.toUpperCase() === "HOME") return os.homedir()
        if (key.toUpperCase() === "PWD") return cwd
        return path.dirname(shell)
      }),
  )
}

function expandKnownDirectory(value: string) {
  // Unknown shell expressions cannot be resolved safely during permission analysis.
  if (value.includes("$") || value.includes("`") || value.startsWith("(")) return
  if (value === "~") return os.homedir()
  if (value.startsWith("~/") || (process.platform === "win32" && value.startsWith("~\\"))) {
    return path.join(os.homedir(), value.slice(2))
  }
  return value
}

function environment(key: string) {
  if (process.platform !== "win32") return process.env[key]
  const name = Object.keys(process.env).find((item) => item.toLowerCase() === key.toLowerCase())
  return name ? process.env[name] : undefined
}

function prefix(tokens: string[]) {
  for (let length = tokens.length; length > 0; length--) {
    const arity = ARITY[tokens.slice(0, length).join(" ")]
    if (arity !== undefined) return tokens.slice(0, arity)
  }
  return tokens.slice(0, 1)
}

function resolve(asset: string) {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (path.isAbsolute(asset)) return asset
  return fileURLToPath(new URL(asset, import.meta.url))
}

const load = lazy(initialize)

async function initialize() {
  const { Parser, Language } = await import("web-tree-sitter")
  await Parser.init({ locateFile: () => resolve(shellParserWasm.runtime) })
  const [bashLanguage, psLanguage] = await Promise.all([
    Language.load(resolve(shellParserWasm.bash)),
    Language.load(resolve(shellParserWasm.powershell)),
  ])
  const bash = new Parser()
  bash.setLanguage(bashLanguage)
  const ps = new Parser()
  ps.setLanguage(psLanguage)
  return { bash, ps }
}
