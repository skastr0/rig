import { Effect } from "effect"
import { AppRuntime } from "./runtime.js"

const main = Effect.gen(function* () {
  yield* Effect.log("system-setup initialized")
})

AppRuntime.runPromise(main)
