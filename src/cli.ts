import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";

export interface CliOptions {
  readonly config: string;
  readonly profile: string | undefined;
  readonly dryRun: boolean;
  readonly tags: readonly string[];
  readonly only: readonly string[];
  readonly verbose: boolean;
  readonly update: boolean;
}

const config = Options.withDefault(
  Options.file("config").pipe(Options.withAlias("c")),
  "./system-config.json",
).pipe(Options.withDescription("Path to JSON config file (default: ./system-config.json)"));

const profile = Options.optional(Options.text("profile").pipe(Options.withAlias("p"))).pipe(
  Options.withDescription("Profile to apply (e.g., 'work', 'personal')"),
);

const dryRun = Options.boolean("dry-run").pipe(
  Options.withAlias("d"),
  Options.withDescription("Preview changes without installing anything"),
);

const tags = Options.withDefault(
  Options.text("tags").pipe(Options.withAlias("t"), Options.repeated),
  [],
).pipe(Options.withDescription("Filter items by tags (can be repeated: -t dev -t editor)"));

const only = Options.withDefault(
  Options.text("only").pipe(Options.withAlias("o"), Options.repeated),
  [],
).pipe(
  Options.withDescription("Install specific items only (can be repeated: -o neovim -o ripgrep)"),
);

const verbose = Options.boolean("verbose").pipe(
  Options.withAlias("v"),
  Options.withDescription("Show detailed output including command execution"),
);

const update = Options.boolean("update").pipe(
  Options.withAlias("u"),
  Options.withDescription("Run update commands for installed items"),
);

const cliOptions = {
  config,
  profile,
  dryRun,
  tags,
  only,
  verbose,
  update,
};

export const makeCommand = <E, R>(handler: (options: CliOptions) => Effect.Effect<void, E, R>) =>
  Command.make("system-setup", cliOptions, (opts) =>
    handler({
      config: opts.config,
      profile: Option.getOrUndefined(opts.profile),
      dryRun: opts.dryRun,
      tags: opts.tags,
      only: opts.only,
      verbose: opts.verbose,
      update: opts.update,
    }),
  ).pipe(
    Command.withDescription(
      `Declarative system configuration tool

Reads a JSON config file and installs only what's missing. Items are checked
for existence before installing. Use --dry-run to preview changes.

Quick Start:
  system-setup --dry-run          # Preview what would be installed
  system-setup                    # Apply configuration
  system-setup -p work            # Apply with 'work' profile
  system-setup -t dev -t editor   # Install items with dev OR editor tags
  system-setup --update           # Update installed items

Docs: See USAGE.md for examples and patterns`,
    ),
  );

export const runCli = <E, R>(handler: (options: CliOptions) => Effect.Effect<void, E, R>) =>
  Command.run(makeCommand(handler), {
    name: "system-setup",
    version: "0.1.0",
  });
