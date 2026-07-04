import { Context, Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import type { PlanResult } from "./Planner.js";
import { ShellService } from "../services/ShellService.js";
import { BackupService } from "../services/BackupService.js";
import { GitService } from "../services/GitService.js";
import { BrewService } from "../services/BrewService.js";
import { executePlan } from "./ExecutionRunner.js";
import { inspectPlan } from "./InspectionRunner.js";
import type { LineDisplayMode, LineTerminator } from "../services/LineBuffer.js";

export type ItemStatus = "installed" | "missing" | "error" | "blocked";
export type ItemAction =
  | "skipped"
  | "installed"
  | "updated"
  | "would_update"
  | "failed"
  | "timed_out"
  | "blocked";

export interface ExecutionPreview {
  readonly label: string;
  readonly steps: readonly string[];
}

export interface ExecutionResult {
  readonly name: string;
  readonly status: ItemStatus;
  readonly action: ItemAction;
  readonly backed_up?: string;
  readonly detail?: string;
  readonly preview?: ExecutionPreview;
  readonly error?: string;
}

interface CommandOutputEvent {
  readonly itemName: string;
  readonly stream: "stdout" | "stderr";
  readonly line: string;
  readonly terminator: LineTerminator;
  readonly displayMode: LineDisplayMode;
}

export type InspectionStatus = "installed" | "missing" | "updateable" | "blocked" | "error";

export interface InspectionResult {
  readonly name: string;
  readonly status: InspectionStatus;
  readonly detail?: string;
  readonly reason?: string;
}

export interface InspectionOptions {
  readonly verbose?: boolean;
  readonly onVerbose?: (message: string) => void;
}

export interface ExecutorOptions {
  readonly dryRun?: boolean;
  readonly update?: boolean;
  readonly verbose?: boolean;
  readonly onProgress?: (result: ExecutionResult) => void;
  readonly onOutput?: (output: CommandOutputEvent) => void;
  readonly onVerbose?: (message: string) => void;
}

export interface Executor {
  readonly execute: (
    plan: PlanResult,
    options?: ExecutorOptions,
  ) => Effect.Effect<
    readonly ExecutionResult[],
    never,
    ShellService | BackupService | GitService | BrewService | FileSystem.FileSystem
  >;
  readonly inspect: (
    plan: PlanResult,
    options?: InspectionOptions,
  ) => Effect.Effect<readonly InspectionResult[], never, ShellService | FileSystem.FileSystem>;
}

export const Executor = Context.GenericTag<Executor>("Executor");

export type ItemCheckResult =
  | { type: "installed" }
  | { type: "missing" }
  | { type: "needs_update"; reason: string };

export const ExecutorLive = Layer.succeed(
  Executor,
  Executor.of({
    inspect: inspectPlan,
    execute: executePlan,
  }),
);
