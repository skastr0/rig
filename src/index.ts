#!/usr/bin/env bun

import { BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";
import { runCli } from "./cli.js";
import { AppLayer } from "./services/AppLayer.js";
import { handler } from "./appHandler.js";

const program = runCli(handler)(process.argv).pipe(Effect.provide(AppLayer));

BunRuntime.runMain(program);
