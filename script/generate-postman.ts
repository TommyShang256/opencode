import path from "node:path"

type Schema = {
  readonly $ref?: string
  readonly type?: string
  readonly format?: string
  readonly pattern?: string
  readonly enum?: readonly unknown[]
  readonly default?: unknown
  readonly example?: unknown
  readonly anyOf?: readonly Schema[]
  readonly oneOf?: readonly Schema[]
  readonly allOf?: readonly Schema[]
  readonly properties?: Readonly<Record<string, Schema>>
  readonly required?: readonly string[]
  readonly items?: Schema
  readonly additionalProperties?: boolean | Schema
}

type Parameter = {
  readonly name: string
  readonly in: "path" | "query" | "header" | "cookie"
  readonly required?: boolean
  readonly description?: string
  readonly style?: string
  readonly schema: Schema
}

type Operation = {
  readonly tags?: readonly string[]
  readonly operationId: string
  readonly summary?: string
  readonly description?: string
  readonly parameters?: readonly Parameter[]
  readonly requestBody?: {
    readonly content?: Readonly<Record<string, { readonly schema?: Schema }>>
  }
  readonly responses?: Readonly<Record<string, { readonly content?: Readonly<Record<string, unknown>> }>>
}

type OpenApi = {
  readonly info: { readonly title: string; readonly version: string; readonly description?: string }
  readonly paths: Readonly<Record<string, Readonly<Record<string, Operation>>>>
  readonly components?: { readonly schemas?: Readonly<Record<string, Schema>> }
}

type Entry = {
  readonly tag: string
  readonly method: string
  readonly pathname: string
  readonly operation: Operation
}

const source = path.resolve(import.meta.dir, "../packages/protocol/openapi.json")
const output = path.resolve(import.meta.dir, "../docs/postman")
const api: OpenApi = await Bun.file(source).json()
const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options"])

const categories = [
  ["health", "01 服务健康"],
  ["server", "02 服务器信息"],
  ["location", "03 位置与工作区"],
  ["agent", "04 Agent"],
  ["plugin", "05 插件"],
  ["session", "06 会话与消息"],
  ["model", "07 模型"],
  ["generate", "08 文本生成"],
  ["provider", "09 Provider"],
  ["integration", "10 集成与认证"],
  ["mcp", "11 MCP"],
  ["credential", "12 凭据"],
  ["project", "13 项目"],
  ["form", "14 交互表单"],
  ["permission", "15 权限"],
  ["filesystem", "16 文件系统"],
  ["command", "17 命令"],
  ["skill", "18 Skill"],
  ["event", "19 事件流"],
  ["pty", "20 PTY 终端"],
  ["shell", "21 Shell 任务"],
  ["reference", "22 引用"],
  ["worktree", "23 Git Worktree"],
  ["vcs", "24 版本控制"],
  ["websearch", "25 网络搜索"],
  ["config", "26 配置"],
  ["debug", "27 调试"],
  ["migration", "28 数据迁移"],
] as const

const entries = Object.entries(api.paths).flatMap(([pathname, value]) =>
  Object.entries(value).flatMap(([method, operation]) =>
    methods.has(method)
      ? [
          {
            tag: operation.tags?.[0] ?? "other",
            method: method.toUpperCase(),
            pathname,
            operation,
          },
        ]
      : [],
  ),
)

const variables: Readonly<Record<string, string>> = {
  agentID: "{{agentId}}",
  attemptID: "{{attemptId}}",
  credentialID: "{{credentialId}}",
  formID: "{{formId}}",
  id: "{{shellId}}",
  inboxID: "{{inboxId}}",
  integrationID: "{{integrationId}}",
  key: "{{key}}",
  messageID: "{{messageId}}",
  projectID: "{{projectId}}",
  providerID: "{{providerId}}",
  ptyID: "{{ptyId}}",
  requestID: "{{requestId}}",
  server: "{{serverName}}",
  sessionID: "{{sessionId}}",
}

const samples: Readonly<Record<string, unknown>> = {
  agent: "{{agentId}}",
  agentID: "{{agentId}}",
  command: "pwd",
  credentialID: "{{credentialId}}",
  cwd: "{{directory}}",
  directory: "{{directory}}",
  formID: "{{formId}}",
  id: "example-id",
  inboxID: "{{inboxId}}",
  integrationID: "{{integrationId}}",
  key: "{{key}}",
  messageID: "{{messageId}}",
  modelID: "{{modelId}}",
  name: "postman-example",
  projectID: "{{projectId}}",
  prompt: "Reply with a short connectivity confirmation.",
  providerID: "{{providerId}}",
  ptyID: "{{ptyId}}",
  query: "OpenCode V2",
  requestID: "{{requestId}}",
  server: "{{serverName}}",
  sessionID: "{{sessionId}}",
  text: "Reply with a short connectivity confirmation.",
  title: "Postman debug session",
  url: "https://example.com",
  workspace: "{{workspaceId}}",
  workspaceID: "{{workspaceId}}",
}

const bodyOverrides: Readonly<Record<string, unknown>> = {
  "v2.session.create": {
    title: "Postman debug session",
    location: { directory: "{{directory}}" },
  },
  "v2.session.prompt": {
    text: "Reply with a short connectivity confirmation.",
    resume: true,
  },
  "v2.pty.create": {
    command: "zsh",
    args: [],
    cwd: "{{directory}}",
    title: "Postman PTY",
  },
  "v2.shell.create": {
    command: "pwd",
    cwd: "{{directory}}",
    timeout: 30000,
  },
}

function resolve(schema: Schema, seen = new Set<string>()): Schema {
  if (!schema.$ref) return schema
  if (seen.has(schema.$ref)) return { type: "object" }
  const prefix = "#/components/schemas/"
  if (!schema.$ref.startsWith(prefix)) return { type: "object" }
  const name = schema.$ref.slice(prefix.length).replaceAll("~1", "/").replaceAll("~0", "~")
  const target = api.components?.schemas?.[name]
  if (!target) return { type: "object" }
  return resolve(target, new Set([...seen, schema.$ref]))
}

function sample(schema: Schema, key = "value", depth = 0): unknown {
  if (depth > 5) return {}
  if (schema.example !== undefined) return schema.example
  if (schema.default !== undefined) return schema.default
  if (schema.enum?.length) return schema.enum[0]
  if (schema.$ref) return sample(resolve(schema), key, depth + 1)
  const union = schema.anyOf ?? schema.oneOf
  if (union) return sample(union.find((item) => item.type !== "null") ?? union[0] ?? {}, key, depth + 1)
  if (schema.allOf) {
    const values = schema.allOf.map((item) => sample(item, key, depth + 1))
    if (values.every((value) => typeof value === "object" && value !== null && !Array.isArray(value)))
      return Object.assign({}, ...values)
    return values[0]
  }
  if (samples[key] !== undefined) return samples[key]
  if (schema.type === "boolean") return true
  if (schema.type === "integer" || schema.type === "number") return 1
  if (schema.type === "array") return []
  if (schema.type === "object" || schema.properties || schema.additionalProperties) {
    const required = new Set(schema.required ?? [])
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).flatMap(([name, value]) =>
        required.has(name) ? [[name, sample(value, name, depth + 1)]] : [],
      ),
    )
  }
  if (schema.format === "date-time") return "2026-01-01T00:00:00.000Z"
  if (schema.pattern?.includes("^ses")) return "{{sessionId}}"
  if (schema.pattern?.includes("^msg_")) return "{{messageId}}"
  if (schema.pattern?.includes("^wrk")) return "{{workspaceId}}"
  return "example"
}

function objectSchema(schema: Schema) {
  const resolved = resolve(schema)
  const union = resolved.anyOf ?? resolved.oneOf
  if (!union) return resolved
  return resolve(union.find((item) => resolve(item).type === "object") ?? union[0] ?? {})
}

function postmanQuery(parameter: Parameter) {
  if (parameter.style !== "deepObject") {
    return [
      {
        key: parameter.name,
        value: String(sample(parameter.schema, parameter.name)),
        description: parameter.description,
        disabled: !parameter.required,
      },
    ]
  }
  return Object.entries(objectSchema(parameter.schema).properties ?? {}).map(([name, schema]) => ({
    key: `${parameter.name}[${name}]`,
    value: String(sample(schema, name)),
    description: parameter.description,
    disabled: parameter.name !== "location" || name !== "directory",
  }))
}

function requestPath(entry: Entry) {
  const replaced = entry.pathname.replaceAll(/\{([^}]+)\}/g, (_, name: string) => variables[name] ?? `{{${name}}}`)
  if (replaced.endsWith("/*")) return replaced.slice(0, -1) + "{{filePath}}"
  return replaced
}

function responseMedia(operation: Operation) {
  return Object.keys(operation.responses?.["200"]?.content ?? {})
}

function tests(operationID: string) {
  if (operationID === "v2.health.get")
    return [
      "pm.test('服务器健康', () => {",
      "  pm.response.to.have.status(200)",
      "  pm.expect(pm.response.json().healthy).to.eql(true)",
      "})",
    ]
  const capture = {
    "v2.session.create": ["sessionId", "id"],
    "v2.session.prompt": ["messageId", "id"],
    "v2.pty.create": ["ptyId", "id"],
    "v2.shell.create": ["shellId", "id"],
  }[operationID]
  if (!capture) return []
  return [
    "if (pm.response.code >= 200 && pm.response.code < 300) {",
    "  const json = pm.response.json()",
    `  const value = json.data?.${capture[1]} ?? json.${capture[1]}`,
    `  if (value) pm.environment.set('${capture[0]}', value)`,
    "}",
  ]
}

function makeRequest(entry: Entry) {
  const operation = entry.operation
  const pathname = requestPath(entry)
  const query = (operation.parameters ?? []).filter((item) => item.in === "query").flatMap(postmanQuery)
  const enabled = query.filter((item) => !item.disabled)
  const suffix = enabled.length
    ? "?" + enabled.map((item) => `${encodeURIComponent(item.key)}=${item.value}`).join("&")
    : ""
  const media = responseMedia(operation)
  const bodySchema = operation.requestBody?.content?.["application/json"]?.schema
  const body = bodyOverrides[operation.operationId] ?? (bodySchema ? sample(bodySchema) : undefined)
  const description = [
    operation.summary,
    operation.description,
    `Operation ID: ${operation.operationId}`,
    media.includes("text/event-stream") ? "响应类型：SSE 事件流。Postman 会保持连接，需手动停止。" : undefined,
    media.includes("application/octet-stream") ? "响应类型：二进制文件。" : undefined,
  ]
    .filter((item) => item)
    .join("\n\n")
  const script = tests(operation.operationId)
  return {
    name: `${operation.summary ?? operation.operationId} · ${operation.operationId}`,
    request: {
      method: entry.method,
      header: [
        {
          key: "Accept",
          value: media.includes("text/event-stream")
            ? "text/event-stream"
            : media.includes("application/octet-stream")
              ? "application/octet-stream"
              : "application/json",
        },
        ...(body === undefined ? [] : [{ key: "Content-Type", value: "application/json" }]),
      ],
      ...(body === undefined
        ? {}
        : {
            body: {
              mode: "raw",
              raw: JSON.stringify(body, null, 2),
              options: { raw: { language: "json" } },
            },
          }),
      url: {
        raw: `{{baseUrl}}${pathname}${suffix}`,
        host: ["{{baseUrl}}"],
        path: pathname.split("/").filter((item) => item),
        ...(query.length ? { query } : {}),
      },
      description,
    },
    response: [],
    ...(script.length
      ? {
          event: [
            {
              listen: "test",
              script: { type: "text/javascript", exec: script },
            },
          ],
        }
      : {}),
  }
}

const collection = {
  info: {
    _postman_id: "c45664cd-cf11-4a1f-9535-d6164768464e",
    name: "OpenCode V2 Server API",
    description:
      "由 packages/protocol/openapi.json 生成。包含当前 V2 Server 的全部接口，并补充实际运行时要求的 HTTP Basic Auth。",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  auth: {
    type: "basic",
    basic: [
      { key: "username", value: "{{username}}", type: "string" },
      { key: "password", value: "{{password}}", type: "string" },
    ],
  },
  variable: [
    { key: "baseUrl", value: "http://127.0.0.1:4096", type: "string" },
    { key: "username", value: "opencode", type: "string" },
    { key: "password", value: "replace-with-a-secret", type: "string" },
  ],
  item: categories.flatMap(([tag, name]) => {
    const requests = entries.filter((entry) => entry.tag === tag)
    return requests.length
      ? [
          {
            name,
            description: `${tag} API，共 ${requests.length} 个接口。`,
            item: requests.map(makeRequest),
          },
        ]
      : []
  }),
}

const environmentValues = [
  ["baseUrl", "http://127.0.0.1:4096", "default"],
  ["username", "opencode", "default"],
  ["password", "replace-with-a-secret", "secret"],
  ["directory", path.resolve(import.meta.dir, ".."), "default"],
  ["workspaceId", "", "default"],
  ["sessionId", "", "default"],
  ["messageId", "", "default"],
  ["projectId", "", "default"],
  ["agentId", "build", "default"],
  ["providerId", "", "default"],
  ["modelId", "", "default"],
  ["integrationId", "", "default"],
  ["attemptId", "", "default"],
  ["credentialId", "", "default"],
  ["formId", "", "default"],
  ["requestId", "", "default"],
  ["inboxId", "", "default"],
  ["ptyId", "", "default"],
  ["shellId", "", "default"],
  ["serverName", "", "default"],
  ["key", "", "default"],
  ["filePath", "README.md", "default"],
].map(([key, value, type]) => ({ key, value, type, enabled: true }))

const environment = {
  id: "9adffca7-893f-4ec7-bb7d-fbe72cf14b91",
  name: "OpenCode V2 Local",
  values: environmentValues,
  _postman_variable_scope: "environment",
  _postman_exported_using: "OpenCode repository generator",
}

const sections = categories.flatMap(([tag, name]) => {
  const operations = entries.filter((entry) => entry.tag === tag)
  if (!operations.length) return []
  return [
    `## ${name}（${operations.length}）`,
    "",
    "| 方法 | 路径 | Operation ID | 说明 |",
    "| --- | --- | --- | --- |",
    ...operations.map(
      (entry) =>
        `| ${entry.method} | \`${entry.pathname}\` | \`${entry.operation.operationId}\` | ${entry.operation.summary ?? "-"} |`,
    ),
    "",
  ]
})

const readme = `# OpenCode V2 Postman 接口清单

本目录由 \`packages/protocol/openapi.json\` 生成，包含 ${entries.length} 个 V2 API operation，按 ${collection.item.length} 个领域分类。

Server 的构建、启动、配置和认证方法请参阅 [OpenCode V2 Server 构建与调测手册](../opencode-server.md)。

## 导入

在 Postman 中依次导入：

1. \`opencode-v2.postman_collection.json\`
2. \`opencode-v2-local.postman_environment.json\`
3. 选择环境 **OpenCode V2 Local**，将 \`password\` 改成启动 Server 时使用的 \`OPENCODE_PASSWORD\`
4. 检查 \`baseUrl\` 和 \`directory\` 是否符合本机环境

## 启动 Server

\`\`\`sh
OPENCODE_CONFIG=/absolute/path/to/opencode.jsonc \\
OPENCODE_CONFIG_PROJECT_DISABLE=true \\
OPENCODE_PASSWORD='replace-with-a-secret' \\
bun dev serve --hostname 127.0.0.1 --port 4096
\`\`\`

Collection 使用集合级 HTTP Basic Auth，用户名固定为 \`opencode\`，密码读取 \`{{password}}\`。

## 推荐调测顺序

1. 调用 \`v2.health.get\` 验证地址和认证。
2. 调用 \`v2.location.get\` 验证 \`directory\`。Location 类接口默认启用 \`location[directory]\` 查询参数。
3. 调用 \`v2.model.list\`、\`v2.provider.list\` 和 \`v2.agent.list\` 检查运行配置。
4. 调用 \`v2.session.create\`。成功后 Collection 会自动写入环境变量 \`sessionId\`。
5. 调用 \`v2.session.prompt\`，再通过 \`v2.session.log\` 或 \`v2.message.list\` 查看结果。

可选查询参数在 Collection 中保留但默认禁用，需要时可在 Postman Params 面板启用。创建 Session、PTY 和 Shell 的请求会自动回填对应 ID。

> [!WARNING]
> Collection 包含删除、停止、执行命令、修改凭据和迁移等有副作用的接口。不要直接使用 Collection Runner 全量运行；请逐个确认请求后发送。

## 重新生成

\`\`\`sh
bun run generate:postman
\`\`\`

${sections.join("\n")}`

const collectionPath = path.join(output, "opencode-v2.postman_collection.json")
const environmentPath = path.join(output, "opencode-v2-local.postman_environment.json")
const readmePath = path.join(output, "README.md")

await Bun.$`mkdir -p ${output}`
await Promise.all([
  Bun.write(collectionPath, JSON.stringify(collection, null, 2) + "\n"),
  Bun.write(environmentPath, JSON.stringify(environment, null, 2) + "\n"),
  Bun.write(readmePath, readme),
])
await Bun.$`bunx prettier --write ${readmePath}`.quiet()

console.log(`Generated ${entries.length} Postman requests in ${output}`)
