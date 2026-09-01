import path from "node:path"

type Schema = {
  $ref?: string
  type?: string
  const?: unknown
  default?: unknown
  enum?: unknown[]
  anyOf?: Schema[]
  oneOf?: Schema[]
  properties?: Record<string, Schema>
  required?: string[]
  items?: Schema
}

type Parameter = {
  name: string
  in: "path" | "query" | "header" | "cookie"
  required?: boolean
  schema?: Schema
}

type Operation = {
  tags?: string[]
  operationId?: string
  summary?: string
  description?: string
  parameters?: Parameter[]
  requestBody?: { content?: Record<string, { schema?: Schema }> }
  responses?: Record<string, { description?: string }>
}

type OpenApi = {
  info: { version: string }
  tags?: Array<{ name: string; description?: string }>
  paths: Record<string, Record<string, Operation | Parameter[]>>
  components?: { schemas?: Record<string, Schema> }
}

const root = path.resolve(import.meta.dirname, "..")
const document = (await Bun.file(path.join(root, "openapi.json")).json()) as OpenApi
const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"])
const operations = Object.entries(document.paths).flatMap(([route, item]) =>
  Object.entries(item).flatMap(([method, operation]) =>
    methods.has(method) ? [{ route, method: method.toUpperCase(), operation: operation as Operation }] : [],
  ),
)
const tags = [
  ...(document.tags?.map((tag) => tag.name) ?? []),
  ...operations.map((entry) => entry.operation.tags?.[0] ?? "untagged"),
].filter((tag, index, values) => values.indexOf(tag) === index)

const variables: Record<string, string> = {
  baseUrl: "http://127.0.0.1:4096",
  username: "opencode",
  password: "replace-with-service-password",
  directory: "/absolute/path/to/project",
  sessionID: "ses_example",
  messageID: "msg_example",
  agentID: "build",
  providerID: "anthropic",
  projectID: "project_example",
  server: "example-server",
  tool: "example-tool",
}

function resolve(schema: Schema | undefined, seen = new Set<string>()): Schema | undefined {
  if (!schema?.$ref || seen.has(schema.$ref)) return schema
  const name = schema.$ref.split("/").at(-1)
  const target = name ? document.components?.schemas?.[name] : undefined
  return target ? resolve(target, new Set([...seen, schema.$ref])) : schema
}

function example(schema: Schema | undefined, name = "value", depth = 0): unknown {
  if (!schema || depth > 10) return {}
  if (schema.const !== undefined) return schema.const
  if (schema.default !== undefined) return schema.default
  if (schema.enum?.length) return schema.enum[0]
  const resolved = resolve(schema)
  if (resolved !== schema) return example(resolved, name, depth + 1)
  const union = schema.anyOf ?? schema.oneOf
  if (union?.length) return example(union.find((item) => item.type !== "null") ?? union[0], name, depth + 1)
  if (schema.type === "array") return [example(schema.items, name.replace(/s$/, ""), depth + 1)]
  if (schema.type === "boolean") return false
  if (schema.type === "integer" || schema.type === "number") return 1
  if (schema.type === "null") return null
  if (schema.type === "string") {
    if (name in variables) return `{{${name}}}`
    if (/id$/i.test(name)) return `{{${name}}}`
    if (/directory|path/i.test(name)) return "{{directory}}"
    if (/url|uri/i.test(name)) return "https://example.com"
    if (/text|content|prompt|query/i.test(name)) return "Hello from Postman"
    return "example"
  }
  const required = schema.required ?? []
  return Object.fromEntries(
    Object.entries(schema.properties ?? {})
      .filter(([key]) => required.includes(key))
      .map(([key, value]) => [key, example(value, key, depth + 1)]),
  )
}

function parameters(entry: (typeof operations)[number]) {
  const common = document.paths[entry.route].parameters
  return [...(Array.isArray(common) ? common : []), ...(entry.operation.parameters ?? [])]
}

function requestBody(operation: Operation) {
  const content = operation.requestBody?.content ?? {}
  const mediaType = Object.keys(content)[0]
  if (!mediaType) return
  return { mediaType, value: example(content[mediaType].schema, "body") }
}

function requestUrl(entry: (typeof operations)[number]) {
  const route = entry.route.replaceAll(/{([^}]+)}/g, "{{$1}}").replace("*", "{{filePath}}")
  const query = parameters(entry)
    .filter((parameter) => parameter.in === "query" && parameter.required)
    .map((parameter) => `${encodeURIComponent(parameter.name)}={{${parameter.name}}}`)
  return `{{baseUrl}}${route}${query.length ? `?${query.join("&")}` : ""}`
}

function curl(entry: (typeof operations)[number]) {
  const body = requestBody(entry.operation)
  return [
    `curl --request ${entry.method} \\`,
    `  --url '${requestUrl(entry)}' \\`,
    `  --user '{{username}}:{{password}}'${body ? " \\" : ""}`,
    ...(body
      ? [
          `  --header 'Content-Type: ${body.mediaType}' \\`,
          `  --data '${JSON.stringify(body.value, null, 2).replaceAll("\n", "\n  ")}'`,
        ]
      : []),
  ].join("\n")
}

function markdownOperation(entry: (typeof operations)[number]) {
  const body = requestBody(entry.operation)
  const declaredParameters = parameters(entry)
  return [
    `### \`${entry.method} ${entry.route}\` — ${entry.operation.summary ?? entry.operation.operationId ?? ""}`,
    "",
    ...(entry.operation.description ? [entry.operation.description, ""] : []),
    `Operation ID: \`${entry.operation.operationId ?? "-"}\``,
    "",
    ...(declaredParameters.length
      ? [
          "| 位置 | 名称 | 必填 |",
          "|---|---|---:|",
          ...declaredParameters.map(
            (parameter) => `| ${parameter.in} | \`${parameter.name}\` | ${parameter.required ? "是" : "否"} |`,
          ),
          "",
        ]
      : []),
    ...(body ? ["请求体示例：", "", "```json", JSON.stringify(body.value, null, 2), "```", ""] : []),
    "响应状态：",
    "",
    ...Object.entries(entry.operation.responses ?? {}).map(
      ([status, response]) => `- \`${status}\`: ${response.description ?? "未声明"}`,
    ),
    "",
    "```bash",
    curl(entry),
    "```",
  ].join("\n")
}

const markdown = [
  "# DataAgent V2 HTTP API 与 Postman 示例",
  "",
  `> 由 \`packages/protocol/openapi.json\`（OpenAPI ${document.info.version}）生成，请勿手工修改接口明细。`,
  "",
  "导入同目录的 `opencode-v2.postman_collection.json` 后，设置 Collection Variables 中的 `baseUrl`、`username` 和 `password`。",
  "",
  `共 **${operations.length}** 个 HTTP 操作、**${tags.length}** 个分类。`,
  "",
  ...tags.flatMap((tag) => {
    const entries = operations.filter((entry) => (entry.operation.tags?.[0] ?? "untagged") === tag)
    return [
      `## ${tag}`,
      "",
      document.tags?.find((item) => item.name === tag)?.description ?? "",
      "",
      ...entries.flatMap((entry) => [markdownOperation(entry), ""]),
    ]
  }),
].join("\n")

const items = tags.map((tag) => ({
  name: tag,
  item: operations
    .filter((entry) => (entry.operation.tags?.[0] ?? "untagged") === tag)
    .map((entry) => {
      const body = requestBody(entry.operation)
      return {
        name: `${entry.method} ${entry.route} — ${entry.operation.summary ?? ""}`,
        request: {
          method: entry.method,
          header: body ? [{ key: "Content-Type", value: body.mediaType }] : [],
          url: requestUrl(entry),
          description: entry.operation.description,
          ...(body
            ? {
                body: { mode: "raw", raw: JSON.stringify(body.value, null, 2), options: { raw: { language: "json" } } },
              }
            : {}),
        },
        response: [],
      }
    }),
}))
const referencedVariables = [
  "username",
  "password",
  ...[...JSON.stringify(items).matchAll(/\{\{([^}]+)}}/g)].map((match) => match[1]),
].filter((key, index, values) => values.indexOf(key) === index)
const collection = JSON.stringify(
  {
    info: {
      name: "DataAgent V2 HTTP API",
      description: `Generated from packages/protocol/openapi.json. Contains ${operations.length} operations.`,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    auth: {
      type: "basic",
      basic: [
        { key: "username", value: "{{username}}", type: "string" },
        { key: "password", value: "{{password}}", type: "string" },
      ],
    },
    variable: referencedVariables.map((key) => ({ key, value: variables[key] ?? "example", type: "string" })),
    item: items,
  },
  null,
  2,
)

const outputs = [
  [path.join(root, "API_REFERENCE.md"), markdown + "\n"],
  [path.join(root, "opencode-v2.postman_collection.json"), collection + "\n"],
] as const
if (process.argv.includes("--check")) {
  const stale = await Promise.all(
    outputs.map(
      async ([file, content]) => !(await Bun.file(file).exists()) || (await Bun.file(file).text()) !== content,
    ),
  )
  if (stale.some(Boolean)) {
    console.error("Generated API reference is stale. Run `bun run generate:reference` from packages/protocol.")
    process.exit(1)
  }
  process.exit(0)
}
await Promise.all(outputs.map(([file, content]) => Bun.write(file, content)))
