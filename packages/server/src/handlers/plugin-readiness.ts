import { Plugin } from "@opencode/core/plugin/service"
import { ServiceUnavailableError } from "@opencode/protocol/errors"
import { Effect } from "effect"

export function pluginReadiness(error: () => ServiceUnavailableError) {
  return Plugin.awaitActivation.pipe(
    Effect.timeoutOrElse({
      duration: "5 seconds",
      orElse: () => Effect.fail(error()),
    }),
  )
}
