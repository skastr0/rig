import { Layer } from "effect"
import { BunContext } from "@effect/platform-bun"
import { ShellServiceLive } from "./ShellService.js"
import { BackupServiceLive } from "./BackupService.js"
import { ConfigServiceLive } from "./ConfigService.js"
import { GitServiceLive } from "./GitService.js"

const ServicesLayer = Layer.mergeAll(
  ShellServiceLive,
  BackupServiceLive,
  ConfigServiceLive,
  GitServiceLive
)

export const AppLayer = ServicesLayer.pipe(Layer.provide(BunContext.layer))
