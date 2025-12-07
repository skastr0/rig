import { Command, Options } from "@effect/cli"
import { Effect, Option } from "effect"

export interface CliOptions {
  readonly config: string
  readonly profile: string | undefined
  readonly dryRun: boolean
  readonly tags: readonly string[]
  readonly only: readonly string[]
  readonly verbose: boolean
}

const config = Options.withDefault(
  Options.file("config").pipe(Options.withAlias("c")),
  "./system-config.json"
).pipe(Options.withDescription("Path to configuration file"))

const profile = Options.optional(
  Options.text("profile").pipe(Options.withAlias("p"))
).pipe(Options.withDescription("Profile to apply"))

const dryRun = Options.boolean("dry-run").pipe(
  Options.withAlias("d"),
  Options.withDescription("Show what would be installed without making changes")
)

const tags = Options.withDefault(
  Options.text("tags").pipe(
    Options.withAlias("t"),
    Options.repeated
  ),
  []
).pipe(Options.withDescription("Filter items by tags"))

const only = Options.withDefault(
  Options.text("only").pipe(
    Options.withAlias("o"),
    Options.repeated
  ),
  []
).pipe(Options.withDescription("Install only specific items by name"))

const verbose = Options.boolean("verbose").pipe(
  Options.withAlias("v"),
  Options.withDescription("Show detailed output")
)

const cliOptions = {
  config,
  profile,
  dryRun,
  tags,
  only,
  verbose,
}

export const makeCommand = <E, R>(
  handler: (options: CliOptions) => Effect.Effect<void, E, R>
) =>
  Command.make(
    "system-setup",
    cliOptions,
    (opts) =>
      handler({
        config: opts.config,
        profile: Option.getOrUndefined(opts.profile),
        dryRun: opts.dryRun,
        tags: opts.tags,
        only: opts.only,
        verbose: opts.verbose,
      })
  ).pipe(Command.withDescription("Declarative system configuration tool"))

export const runCli = <E, R>(
  handler: (options: CliOptions) => Effect.Effect<void, E, R>
) =>
  Command.run(makeCommand(handler), {
    name: "system-setup",
    version: "0.1.0",
  })
