# OpenCode V2 Promise Plugin API

The Promise plugin API at `@opencode/plugin` is the async/await equivalent of `@opencode/plugin/effect`. It grants plugins the same two in-process capabilities:

- `hook` installs behavior at an OpenCode extension point.
- `reload` reruns every transform hook for a stateful domain.

The Promise API uses Promises instead of Effects for setup, runtime hook
callbacks, hook registration, `reload`, and `Registration.dispose`. Transform
editor callbacks remain synchronous.

## Defining A Plugin

```ts
import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "example",
  setup: async (ctx) => {
    await ctx.provider.transform((editor) => {
      editor.update("example", (provider) => {
        provider.name = "Example"
      })
    })
  },
})
```

Plugin setup registers hooks imperatively through each domain's `hook` method.
It may return a synchronous or asynchronous cleanup function. OpenCode awaits
the cleanup when the plugin is unloaded or replaced:

```ts
setup: async (ctx) => {
  const timer = setInterval(refresh, 60_000)
  return () => clearInterval(timer)
}
```

Configuration supplied for the plugin is available as `ctx.options`.

A registration may be removed early through `dispose`:

```ts
const registration = await ctx.model.transform(applyModelPolicy)
await registration.dispose()
```

## Transform Hooks

Transform hooks contribute to stateful domains. The editor is synchronous,
so load asynchronous data before registering a transform or reloading its domain:

```ts
const description = await loadReviewerDescription()

await ctx.agent.transform((agent) => {
  agent.update("reviewer", (item) => {
    item.description = description
    item.mode = "subagent"
  })
})
```

Available transform hooks are namespaced by domain:

```ts
ctx.agent.transform
ctx.command.transform
ctx.integration.transform
ctx.mcp.transform
ctx.model.transform
ctx.provider.transform
ctx.reference.transform
ctx.skill.transform
ctx.tool.transform
ctx.vcs.transform
ctx.websearch.transform
```

Provider transforms contribute provider settings and immutable model definitions. After provider availability is resolved,
model transforms edit the complete active-provider candidate collection in order. Use `ctx.model.transform` for runtime
model restrictions; `editor.provider.get()` reads source templates even when their provider is inactive.

```ts
await ctx.model.transform((editor) => {
  editor
    .list()
    .filter((model) => model.cost.some((tier) => tier.output > 20))
    .forEach((model) => {
      editor.remove(model.providerID, model.id)
    })
})
```

## Runtime Hooks

Runtime hooks intercept live operations:

```ts
await ctx.aisdk.hook("sdk", async (event) => {
  if (event.package !== "@ai-sdk/xai") return
  const mod = await import("@ai-sdk/xai")
  event.sdk = mod.createXai(event.options)
})

await ctx.aisdk.hook("language", (event) => {
  if (event.model.providerID !== "xai") return
  event.language = event.sdk.responses(event.model.modelID)
})
```

Session context is mutable immediately before provider dispatch:

```ts
await ctx.session.hook("context", (event) => {
  event.tools.read.description = "Read a file using narrow line ranges."
  delete event.tools.write
})

await ctx.session.hook("retry", (event) => {
  if (event.attempt >= 3) event.decision = { retry: false }
})
```

Promise tools use complete executable tool values with async executors:

The `shell.create.before` event also exposes optional, read-only `toolContext`
(`sessionID`, `messageID`, `executionID`, `agent`). For a native shell tool this is
a frozen copy of its execution identity supplied by Core, not parsed from the
command, environment or public shell metadata. Direct shell API calls have no
`toolContext`, even if their metadata contains similarly named fields. Plugins
may use this association to prepare execution-scoped integration state; it is
not an authorization token or proof that the execution is still active. Keep
external bridge authorization and expiry checks at the bridge itself. No IDs
are automatically injected into the child environment or persisted by this hook.

Core separately issues an opaque `OPENCODE_TOOL_CONTEXT` reference for a native
shell child process. `ShellContext.Service` can resolve it only while the shell's
scope is alive; normal completion revokes it before notifying waiters, and scope
cleanup also revokes it on spawn failure or cancellation. Direct shell API calls
clear this environment variable rather than inheriting another execution's
reference. References are process-local, not durable session credentials, and
must not be logged, included in model prompts or copied into metadata. Possession
alone is not tool authorization: bridge consumers must still enforce their caller
policy and current session/run state.

The MCP HTTP call bridge consumes this reference through `x-opencode-tool-context`.
Native shell children also receive `OPENCODE_TOOL_DIRECTORY` and, for explicit
workspace placement, `OPENCODE_TOOL_WORKSPACE`; clients use the existing location
headers to address the owning Location rather than their current subdirectory.
The bridge rejects unknown/revoked references, caller-supplied session/agent
mismatches, and a different Location. It rechecks reference liveness immediately
before the remote call. It never returns the reference or copies it into MCP tool
arguments. A scoped call passes its resolved session ID in MCP metadata, not a
fabricated model tool execution. Native bridge calls additionally send
`_meta.script` with the short-lived reference and native directory/workspace.
Only the selected MCP server receives this provenance; script-enabled servers
must be trusted to handle it without logging or persisting it. Receivers must
resolve it through the authenticated runtime and recheck product authorization;
the metadata itself is not proof. It never enters business tool arguments.

`ctx.mcp.hook("bridge.validate", callback)` receives a detached view of the target,
arguments and optional resolved `toolContext`. Product plugins may reject through
`ctx.tool.reject`; the bridge returns a sanitized `MCP_BRIDGE_CALL_DENIED` rather
than exposing that plugin error. The validator runs before permission prompts or
fallback bridge-session creation. No reference means no native tool identity;
plugins requiring scoped execution must reject that case. Existing caller and
permission checks remain in place. This hook does not prove product Run/Project
authorization; that remains a separate responsibility.

Scoped server/tool catalog reads use the same reference and Location checks.
`ctx.mcp.hook("bridge.catalog", callback)` receives resolved `toolContext` and a
mutable list of `{ server, name }` identities after script-caller filtering.
Each callback can only narrow the previous list: additions cannot restore tools
removed by another callback. Reference liveness is checked again after hooks.
Expired or mismatched references return 403, not an unscoped catalog fallback.
Unscoped administrative reads retain the installed inventory; visibility there
does not grant permission to execute a tool.

`GET /api/mcp/bridge/context` resolves the same header against the owning
Location and returns only `sessionID`, `messageID`, `executionID`, and `agent`.
Unlike administrative catalog reads, it requires a live native reference.
Consumers must use the existing authenticated server connection and must not log
the reference. This snapshot enables independent product scope checks; it is not
a durable lease, tool-call attestation, or evidence of Project authorization.

An `execute.before` hook can call `ctx.tool.reject(message)` to reject an operation
before tool side effects. This throws the existing typed `Tool.Error`; the Promise
adapter preserves that expected failure, including in async hooks. Use a safe,
user-appropriate message, not a raw transport exception or request payload.
Ordinary hook exceptions remain defects. Rejection from `execute.after` also
remains a defect: an after hook cannot undo an already executed operation.

```ts
await ctx.tool.hook("execute.before", (event) => {
  if (!allowed(event.sessionID, event.tool)) ctx.tool.reject("Tool is not available for this task")
})
```

```ts
import { Schema } from "effect"

await ctx.tool.transform((tools) => {
  tools.add({
    name: "echo",
    options: { codemode: false },
    description: "Echo text",
    input: Schema.Struct({ text: Schema.String }),
    output: Schema.Struct({ text: Schema.String }),
    execute: async ({ text }) => ({ output: { text }, content: text }),
  })
})
```

## Reloading A Domain

When data captured by a transform changes, reload the affected domain:

```ts
const source = { providers: await loadProviders() }

await ctx.provider.transform((editor) => {
  source.providers.forEach((provider) => editor.add(provider))
})

source.providers = await loadProviders()
await ctx.provider.reload()
```

`loadProviders()` returns entries shaped as `{ info: Provider.Info, models: readonly Model.Info[] }`. Provider reloads
also invalidate the active model result, so every model transform runs again with the refreshed definitions. Model
callbacks edit raw overrides; provider defaults are merged once when the result is committed.

Available reload operations are:

```ts
ctx.agent.reload()
ctx.command.reload()
ctx.integration.reload()
ctx.mcp.reload()
ctx.model.reload()
ctx.provider.reload()
ctx.reference.reload()
ctx.skill.reload()
ctx.tool.reload()
ctx.vcs.reload()
ctx.websearch.reload()
```
