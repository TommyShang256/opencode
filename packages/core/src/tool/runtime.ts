import type { ToolDefinition } from "@opencode/ai"
import { Tool } from "@opencode/schema/tool"
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec"
import { Cache, Effect, JsonSchema, Schema, SchemaIssue, SchemaRepresentation } from "effect"
import { $ZodType, toJSONSchema } from "zod/v4/core"

const formatEffectIssues = SchemaIssue.makeFormatterStandardSchemaV1()

const jsonSchemas = Effect.runSync(
  Cache.make<JsonSchema.JsonSchema, Schema.Codec<unknown> | undefined>({
    capacity: 100,
    lookup: (schema) =>
      Effect.try({
        try: () => jsonSchema(schema),
        catch: () => undefined,
      }).pipe(Effect.orElseSucceed(() => undefined)),
  }),
)

export const definition = (tool: Tool.Info<any, any>): ToolDefinition => ({
  type: "tool",
  name: effectiveName(tool),
  description: tool.description,
  inputSchema: inputJsonSchema(tool.input),
  ...(tool.output === undefined ? {} : { outputSchema: outputJsonSchema(tool.output) }),
})

export const execute = (
  tool: Tool.Info<any, any>,
  input: unknown,
  context: Tool.Context,
  onInput?: (input: unknown) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const decoded = yield* decodeInput(tool, input)
    if (onInput) yield* onInput(decoded)
    // Tool implementations declare `Tool.Error` but plugins can fail with anything at
    // runtime. A foreign typed failure would slip past every `catchTag("Tool.Error")`
    // downstream and leave its call permanently unsettled, so the declared contract is
    // enforced here at the untrusted boundary. Declines tunnel through as defects and
    // interrupts are not errors; neither is touched.
    const result = yield* tool.execute(decoded, context).pipe(
      Effect.mapError((error: unknown) =>
        error instanceof Tool.Error
          ? error
          : new Tool.Error({
              message: error instanceof globalThis.Error ? error.message : String(error),
            }),
      ),
    )
    if (tool.output === undefined) {
      if ("output" in result) return yield* Effect.die("Tool result declared output without an output schema")
      return {
        output: undefined,
        content: normalizeContent(result.content),
        ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
      }
    }
    if (!("output" in result)) return yield* new Tool.Error({ message: "Tool did not return its declared output" })
    const output = yield* encodeOutput(tool.output, result.output)
    return {
      output,
      content: normalizeContent(result.content, output),
      ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
    }
  })

const decodeInput = (tool: Tool.Info<any, any>, value: unknown) =>
  Effect.gen(function* () {
    const result = yield* validateInput(tool.input, value)
    if (!result.issues) return result.value
    const parsed = parseStringifiedArguments(value, invalidKeys(result.issues))
    if (parsed.unparsable.length > 0)
      return yield* new Tool.Error({
        message: formatInputIssues(
          effectiveName(tool),
          parsed.unparsable.map(({ key, reason }) => ({
            path: [key],
            message: `Expected object; the value is JSON text that does not parse (${reason}). Send it as an object, not a string`,
          })),
          value,
        ),
      })
    if (parsed.value === value)
      return yield* new Tool.Error({ message: formatInputIssues(effectiveName(tool), result.issues, value) })
    // Once the text parses, what is still wrong with the object is the useful report.
    const retried = yield* validateInput(tool.input, parsed.value)
    if (!retried.issues) return retried.value
    return yield* new Tool.Error({ message: formatInputIssues(effectiveName(tool), retried.issues, parsed.value) })
  })

// Some models send an object or array argument as its JSON text. Only the top-level arguments that failed
// validation are parsed and retried, so a parameter that really takes a string still receives the string.
const invalidKeys = (issues: ReadonlyArray<StandardSchemaV1.Issue>) =>
  new Set(
    issues.flatMap((issue) => {
      const first = issue.path?.[0]
      const key = typeof first === "object" ? first.key : first
      return typeof key === "string" ? [key] : []
    }),
  )

// Some upstream models drop trailing closing brackets of JSON text arguments; when only those are missing the
// completion is unambiguous. DataAgent's invocation verifier applies the same completion.
const closeUnbalanced = (text: string) => {
  const open: string[] = []
  let inString = false
  let escaped = false
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') inString = false
    } else if (char === '"') inString = true
    else if (char === "{" || char === "[") open.push(char)
    else if (char === "}" || char === "]") {
      if (open.pop() !== (char === "}" ? "{" : "[")) return undefined
    }
  }
  if (inString || open.length === 0) return undefined
  return text + open.reverse().map((char) => (char === "{" ? "}" : "]")).join("")
}

const parseStringifiedArguments = (value: unknown, keys: ReadonlySet<string>) => {
  const unparsable: { key: string; reason: string }[] = []
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { value, unparsable }
  let changed = false
  const parsed = Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (!keys.has(key) || typeof item !== "string") return [key, item]
      const text = item.trim()
      // A dropped trailing bracket can leave "{...]" behind, so either closing bracket qualifies.
      if (!/^[{[]/.test(text) || !/[}\]]$/.test(text)) return [key, item]
      try {
        const json: unknown = JSON.parse(text)
        changed = true
        return [key, json]
      } catch (error) {
        const closed = closeUnbalanced(text)
        if (closed !== undefined) {
          try {
            const json: unknown = JSON.parse(closed)
            changed = true
            return [key, json]
          } catch {}
        }
        unparsable.push({ key, reason: error instanceof Error ? error.message : String(error) })
        return [key, item]
      }
    }),
  )
  return { value: changed ? parsed : value, unparsable }
}

const validateInput = (
  schema: Tool.ValueSchema<any>,
  value: unknown,
): Effect.Effect<StandardSchemaV1.Result<unknown>> => {
  if (isStandardSchema(schema)) return validateStandard(schema, value)
  return Effect.gen(function* () {
    const codec = Schema.isSchema(schema) ? schema : yield* Cache.get(jsonSchemas, schema)
    if (codec === undefined) return { value }
    return yield* Schema.decodeUnknownEffect(codec)(value, { errors: "all" }).pipe(
      Effect.match({
        onFailure: (error) => formatEffectIssues(error.issue),
        onSuccess: (value) => ({ value }),
      }),
    )
  })
}

const formatInputIssues = (tool: string, issues: ReadonlyArray<StandardSchemaV1.Issue>, value: unknown) => {
  const details = issues.slice(0, 5).map((issue) => {
    const path =
      issue.path?.reduce<string>((path, segment) => {
        const key = typeof segment === "object" ? segment.key : segment
        if (typeof key === "number") return `${path}[${key}]`
        return path === "" ? String(key) : `${path}.${String(key)}`
      }, "") || "root"
    return `- ${path}: ${issue.message}`
  })
  if (issues.length > 5) details.push(`- ...and ${issues.length - 5} more ${issues.length === 6 ? "issue" : "issues"}`)
  return `Invalid arguments for tool "${tool}":\n${details.join("\n")}\n\nArguments provided:\n${JSON.stringify(value, null, 2)}\n\nUpdate the arguments and call the tool again.`
}

const jsonSchema = (schema: JsonSchema.JsonSchema) => {
  const draft =
    (typeof schema.$schema === "string" && schema.$schema.includes("draft-07")) || "definitions" in schema
      ? JsonSchema.fromSchemaDraft07(schema)
      : JsonSchema.fromSchemaDraft2020_12(schema)
  return Schema.make<Schema.Codec<unknown>>(SchemaRepresentation.fromJsonSchemaDocument(draft).ast)
}

const encodeOutput = (schema: Tool.ValueSchema<any>, value: unknown) => {
  if (Schema.isSchema(schema))
    return Schema.encodeEffect(schema)(value).pipe(
      Effect.mapError(
        (error) =>
          new Tool.Error({ message: `Tool returned an invalid value for its output schema: ${error.message}` }),
      ),
    )
  if (isStandardSchema(schema))
    return validateStandard(schema, value).pipe(
      Effect.flatMap((result) =>
        result.issues
          ? new Tool.Error({
              message: `Tool returned an invalid value for its output schema: ${result.issues.map((issue) => issue.message).join(", ")}`,
            })
          : Effect.succeed(result.value),
      ),
    )
  return Schema.decodeUnknownEffect(Schema.Json)(value).pipe(
    Effect.mapError(
      (error) => new Tool.Error({ message: `Tool returned a non-JSON value for its output schema: ${error.message}` }),
    ),
  )
}

const isStandardSchema = (schema: Tool.ValueSchema<any>): schema is StandardSchemaV1<any, any> =>
  typeof schema === "object" && schema !== null && "~standard" in schema

const isStandardJSONSchema = (
  schema: StandardSchemaV1<any, any>,
): schema is StandardSchemaV1<any, any> & StandardJSONSchemaV1<any, any> => "jsonSchema" in schema["~standard"]

const validateStandard = (
  schema: StandardSchemaV1<any, any>,
  value: unknown,
): Effect.Effect<StandardSchemaV1.Result<unknown>> =>
  Effect.gen(function* () {
    const result = yield* Effect.try({ try: () => schema["~standard"].validate(value), catch: (error) => error })
    return result instanceof Promise ? yield* Effect.tryPromise({ try: () => result, catch: (error) => error }) : result
  }).pipe(
    Effect.match({
      onFailure: (error) => ({ issues: [{ message: error instanceof Error ? error.message : String(error) }] }),
      onSuccess: (result) => result,
    }),
  )

const inputJsonSchema = (schema: Tool.ValueSchema<any>): JsonSchema.JsonSchema => {
  if (schema === undefined || schema === null) return {}
  if (isStandardSchema(schema)) return standardJsonSchema(schema, "input")
  return Schema.isSchema(schema) ? toJsonSchema(schema) : schema
}

const outputJsonSchema = (schema: Tool.ValueSchema<any>): JsonSchema.JsonSchema => {
  if (isStandardSchema(schema)) return standardJsonSchema(schema, "output")
  return Schema.isSchema(schema) ? toJsonSchema(schema) : schema
}

const standardJsonSchema = (schema: StandardSchemaV1<any, any>, io: "input" | "output"): JsonSchema.JsonSchema => {
  if (isStandardJSONSchema(schema)) return schema["~standard"].jsonSchema[io]({ target: "draft-2020-12" })
  if (schema instanceof $ZodType) return toJSONSchema(schema, { target: "draft-2020-12", io })
  throw new Error(`Schema vendor "${schema["~standard"].vendor}" does not support JSON Schema conversion`)
}

const toJsonSchema = (schema: Schema.Top): JsonSchema.JsonSchema => {
  const document = Schema.toJsonSchemaDocument(schema)
  // Effect emits valid JSON Schema that some inference providers handle poorly. Simplify it
  // without changing validation: `{ type: "integer", allOf: [{ minimum: 0 }] }` becomes
  // `{ type: "integer", minimum: 0 }` only when no keyword would be overwritten. Named schemas
  // emit `$ref` plus root `$defs`; inline acyclic local references so providers receive the full
  // nested schema directly, then remove unused `$defs`. Recursive references stay intact because
  // expanding them would never terminate.
  const normalized = flattenAllOf(
    Object.keys(document.definitions).length === 0
      ? document.schema
      : { ...document.schema, $defs: document.definitions },
  )
  return dropDefinitionsIfResolved(inlineLocalReferences(normalized)) as JsonSchema.JsonSchema
}

const flattenAllOf = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(flattenAllOf)
  if (typeof value !== "object" || value === null) return value

  const schema = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, flattenAllOf(item)]))
  if (!Array.isArray(schema.allOf) || !schema.allOf.every(isRecord) || !canFlattenAllOf(schema.allOf, schema))
    return schema
  const { allOf, ...rest } = schema
  return flattenAllOf({ ...Object.assign({}, ...allOf), ...rest })
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const canFlattenAllOf = (allOf: ReadonlyArray<Record<string, unknown>>, parent: Record<string, unknown>) => {
  const keys = new Set(Object.keys(parent).filter((key) => key !== "allOf"))
  return allOf.every((item) =>
    Object.keys(item).every((key) => {
      if (keys.has(key)) return false
      keys.add(key)
      return true
    }),
  )
}

const inlineLocalReferences = (
  value: unknown,
  definitions?: Record<string, unknown>,
  seen = new Set<string>(),
): unknown => {
  if (Array.isArray(value)) return value.map((item) => inlineLocalReferences(item, definitions, seen))
  if (!isRecord(value)) return value

  const localDefinitions = definitions ?? (isRecord(value.$defs) ? value.$defs : undefined)
  if (typeof value.$ref === "string" && localDefinitions) {
    const segment = value.$ref.match(/^#\/\$defs\/([^/]+)$/)?.[1]
    const name = segment?.replaceAll("~1", "/").replaceAll("~0", "~")
    if (name && !seen.has(name)) {
      const target = localDefinitions[name]
      if (target) {
        const { $ref: _, ...rest } = value
        const resolvedTarget = inlineLocalReferences(target, localDefinitions, new Set(seen).add(name))
        const resolvedSiblings = inlineLocalReferences(rest, localDefinitions, seen)
        if (!isRecord(resolvedTarget) || !isRecord(resolvedSiblings)) return resolvedTarget
        if (canMergeRecords(resolvedTarget, resolvedSiblings)) return { ...resolvedTarget, ...resolvedSiblings }
        return { allOf: [resolvedTarget, resolvedSiblings] }
      }
    }
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, inlineLocalReferences(item, localDefinitions, seen)]),
  )
}

const canMergeRecords = (left: Record<string, unknown>, right: Record<string, unknown>) =>
  Object.keys(left).every((key) => !(key in right))

const dropDefinitionsIfResolved = (value: unknown): unknown => {
  if (!isRecord(value) || hasLocalReference(value)) return value
  const { $defs: _, ...rest } = value
  return rest
}

const hasLocalReference = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasLocalReference)
  if (!isRecord(value)) return false
  if (typeof value.$ref === "string" && value.$ref.startsWith("#/$defs/")) return true
  return Object.values(value).some(hasLocalReference)
}

export const normalizeContent = (value: string | ReadonlyArray<Tool.Content> | undefined, output?: unknown) => {
  if (typeof value === "string") return [{ type: "text" as const, text: value }]
  if (value !== undefined && value.length > 0) return [...value]
  return [{ type: "text" as const, text: stringify(output) }]
}

const stringify = (value: unknown) => {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

export const normalizedName = (tool: Tool.Info) => tool.name.replace(/[^a-zA-Z0-9_-]/g, "_")

export const effectiveName = (tool: Tool.Info) =>
  tool.options?.namespace === undefined
    ? normalizedName(tool)
    : `${tool.options.namespace.replaceAll(".", "_")}_${normalizedName(tool)}`
