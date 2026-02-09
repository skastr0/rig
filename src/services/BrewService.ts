import { Context, Effect, Layer } from "effect";
import { BrewError } from "../errors.js";
import { ShellService } from "./ShellService.js";
import type { BrewInstall } from "../schema/config.js";

export interface BrewService {
  readonly install: (brew: BrewInstall) => Effect.Effect<void, BrewError, ShellService>;
}

export const BrewService = Context.GenericTag<BrewService>("BrewService");

export const BrewServiceLive = Layer.succeed(
  BrewService,
  BrewService.of({
    install: (brew) =>
      Effect.gen(function* () {
        const shell = yield* ShellService;
        const formulaOrCask = brew.formula ?? brew.cask ?? "unknown";

        if (brew.tap) {
          yield* shell.exec("brew", ["tap", brew.tap]).pipe(
            Effect.mapError(
              (error) =>
                new BrewError({
                  formula_or_cask: formulaOrCask,
                  reason: `Failed to tap ${brew.tap} (exit ${error.exitCode}): ${error.stderr}`,
                }),
            ),
          );
        }

        if (brew.formula) {
          const formula = brew.formula;
          yield* shell.exec("brew", ["install", formula, ...(brew.args ?? [])]).pipe(
            Effect.mapError(
              (error) =>
                new BrewError({
                  formula_or_cask: formula,
                  reason: `Failed to install formula ${formula} (exit ${error.exitCode}): ${error.stderr}`,
                }),
            ),
          );
          return;
        }

        if (brew.cask) {
          const cask = brew.cask;
          yield* shell.exec("brew", ["install", "--cask", cask, ...(brew.args ?? [])]).pipe(
            Effect.mapError(
              (error) =>
                new BrewError({
                  formula_or_cask: cask,
                  reason: `Failed to install cask ${cask} (exit ${error.exitCode}): ${error.stderr}`,
                }),
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
