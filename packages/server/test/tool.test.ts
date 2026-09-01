import { expect, test } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Image } from "@opencode-ai/core/image"
import { Location } from "@opencode-ai/core/location"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Tool } from "@opencode-ai/core/tool"
import { ToolGroup } from "@opencode-ai/protocol/groups/tool"
import { ProjectID } from "@opencode-ai/schema/project-id"
import type { Info } from "@opencode-ai/schema/tool"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Context, Effect, Layer, Schema, type Scope } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi"
import { response } from "../src/location"

const TestApi = HttpApi.make("test").add(ToolGroup)

const image = Layer.mock(Image.Service, {
  normalize: () => Effect.die("Image.normalize is not used by this test"),
})

const location = Layer.succeed(Location.Service, {
  directory: AbsolutePath.make("/tmp/opencode-tool-api-test"),
  project: {
    id: ProjectID.make("tool-api-test"),
    directory: AbsolutePath.make("/tmp/opencode-tool-api-test"),
    canonical: AbsolutePath.make("/tmp/opencode-tool-api-test"),
  },
})

const toolLayer = AppNodeBuilder.build(LayerNode.group([Tool.node, PluginHooks.node]), [Image.node.replace(image)])

// Mirrors the production handler wiring in src/handlers/tool.ts against a test-local API so the
// full application graph (and a bound port) is not required.
const serve = Effect.gen(function* () {
  const services = yield* Layer.build(toolLayer)
  const dependencies = Layer.merge(Layer.succeedContext(services), location)
  const group = HttpApiBuilder.group(TestApi, "server.tool", (handlers) =>
    handlers.handle("tool.list", () => response(Tool.Service.use((tool) => tool.list()))),
  )
  const api = HttpApiBuilder.layer(TestApi).pipe(
    Layer.provide(group),
    HttpRouter.provideRequest(dependencies),
    Layer.provideMerge(HttpRouter.layer),
    Layer.provideMerge(HttpServer.layerServices),
  )
  const context = yield* Layer.build(api)
  return {
    tools: Context.get(services, Tool.Service),
    handler: Context.get(context, HttpRouter.HttpRouter).asHttpEffect().pipe(HttpEffect.toWebHandlerWith(context)),
  }
})

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) => effect.pipe(Effect.scoped, Effect.runPromise)

interface ToolListResponse {
  readonly location: { readonly directory: string }
  readonly data: ReadonlyArray<{
    readonly name: string
    readonly description: string
    readonly parameters: { readonly type?: string; readonly properties?: Record<string, { readonly type?: string }> }
  }>
}

test("GET /api/tool returns an empty list when no tools are registered", async () => {
  await run(
    Effect.gen(function* () {
      const { handler } = yield* serve
      const res = yield* Effect.promise(() => handler(new Request("http://localhost/api/tool")))
      expect(res.status).toBe(200)
      const body = (yield* Effect.promise(() => res.json())) as ToolListResponse
      expect(body.location.directory).toBe("/tmp/opencode-tool-api-test")
      expect(body.data).toEqual([])
    }),
  )
})

test("GET /api/tool lists every registered tool with name, description and input schema", async () => {
  await run(
    Effect.gen(function* () {
      const { tools, handler } = yield* serve

      const alpha: Info = {
        name: "alpha",
        description: "Alpha tool",
        input: Schema.Struct({ text: Schema.String }),
        execute: () => Effect.succeed({ content: "ok" }),
      }
      const beta: Info = {
        name: "beta",
        description: "Beta tool",
        input: Schema.Struct({ count: Schema.Int }),
        execute: () => Effect.succeed({ content: "ok" }),
      }
      yield* tools.transform((draft) => {
        draft.add(alpha)
        draft.add(beta)
      })

      const res = yield* Effect.promise(() => handler(new Request("http://localhost/api/tool")))
      expect(res.status).toBe(200)
      const body = (yield* Effect.promise(() => res.json())) as ToolListResponse
      expect(body.location.directory).toBe("/tmp/opencode-tool-api-test")

      // Ops inventory view: entries appear under their own names (no codemode "execute"
      // aggregation, no permission filtering — snapshot() would collapse these).
      expect(body.data.map((item) => item.name)).toEqual(["alpha", "beta"])

      const entry = body.data.find((item) => item.name === "alpha")
      expect(entry.description).toBe("Alpha tool")
      expect(entry.parameters.type).toBe("object")
      expect(entry.parameters.properties.text.type).toBe("string")

      const other = body.data.find((item) => item.name === "beta")
      expect(other.description).toBe("Beta tool")
      expect(other.parameters.properties.count.type).toBe("integer")
    }),
  )
})

test("GET /api/tool reflects deregistration once the registering scope closes", async () => {
  await run(
    Effect.gen(function* () {
      const { tools, handler } = yield* serve
      const get = () =>
        Effect.gen(function* () {
          const res = yield* Effect.promise(() => handler(new Request("http://localhost/api/tool")))
          return (yield* Effect.promise(() => res.json())) as ToolListResponse
        })

      const scoped = Effect.gen(function* () {
        yield* tools.transform((draft) =>
          draft.add({
            name: "ephemeral",
            description: "Scoped tool",
            input: Schema.Struct({}),
            execute: () => Effect.succeed({ content: "ok" }),
          }),
        )
        expect((yield* get()).data.map((item) => item.name)).toEqual(["ephemeral"])
      })
      yield* Effect.scoped(scoped)

      expect((yield* get()).data).toEqual([])
    }),
  )
})
