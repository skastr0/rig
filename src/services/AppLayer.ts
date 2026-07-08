import { Layer } from "effect";
import { BunContext } from "@effect/platform-bun";
import { ShellServiceLive } from "./ShellService.js";
import { BackupServiceLive } from "./BackupService.js";
import { ConfigServiceLive } from "./ConfigService.js";
import { GitHubCliLive } from "./GitHubCliService.js";
import { GitServiceLive } from "./GitService.js";
import { BrewServiceLive } from "./BrewService.js";
import { ExecutorLive } from "../engine/Executor.js";

const ServicesLayer = Layer.mergeAll(
  ShellServiceLive,
  BackupServiceLive,
  ConfigServiceLive,
  GitHubCliLive,
  GitServiceLive,
  BrewServiceLive,
  ExecutorLive,
);

export const AppLayer = ServicesLayer.pipe(Layer.provideMerge(BunContext.layer));
