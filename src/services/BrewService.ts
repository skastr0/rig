import { Context, Effect, Layer } from "effect";
import { BrewError, ShellError } from "../errors.js";
import { ShellService } from "./ShellService.js";
import type { BrewInstall, TimeoutInput } from "../schema/config.js";

export interface BrewService {
  readonly install: (
    brew: BrewInstall,
    options?: { timeout?: TimeoutInput },
  ) => Effect.Effect<void, BrewError, ShellService>;
}

export const BrewService = Context.GenericTag<BrewService>("BrewService");

const mapBrewShellError = (formulaOrCask: string, reason: string, error: ShellError): BrewError =>
  new BrewError({
    formula_or_cask: formulaOrCask,
    reason,
    command: error.command,
    exitCode: error.exitCode,
    stderr: error.stderr,
    ...(error.timedOut === undefined ? {} : { timedOut: error.timedOut }),
    ...(error.timeoutMs === undefined ? {} : { timeoutMs: error.timeoutMs }),
  });

export const BrewServiceLive = Layer.succeed(
  BrewService,
  BrewService.of({
    install: (brew, options) =>
      Effect.gen(function* () {
        const shell = yield* ShellService;
        const formulaOrCask = brew.formula ?? brew.cask ?? "unknown";

        if (brew.tap) {
          yield* shell
            .exec("brew", ["tap", brew.tap], options)
            .pipe(
              Effect.mapError((error) =>
                mapBrewShellError(formulaOrCask, `Failed to tap ${brew.tap}`, error),
              ),
            );
        }

        if (brew.formula) {
          const formula = brew.formula;
          yield* shell
            .exec("brew", ["install", formula, ...(brew.args ?? [])], options)
            .pipe(
              Effect.mapError((error) =>
                mapBrewShellError(formula, `Failed to install formula ${formula}`, error),
              ),
            );
          return;
        }

        if (brew.cask) {
          const cask = brew.cask;
          yield* shell
            .exec("brew", ["install", "--cask", cask, ...(brew.args ?? [])], options)
            .pipe(
              Effect.mapError((error) =>
                mapBrewShellError(cask, `Failed to install cask ${cask}`, error),
              ),
            );
          return;
        }

        yield* Effect.fail(
          new BrewError({
            formula_or_cask: formulaOrCask,
            reason: "Invalid brew install strategy",
          }),
        );
      }),
  }),
);
