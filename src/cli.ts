import { Args, CliApp, Command, Options, ValidationError as CliValidationError } from "@effect/cli";
import { Effect, Option } from "effect";
import { defaultConfigSource, defaultGitHubConfigPath } from "./configSource.js";

export interface CliOptions {
  readonly config: string;
  readonly profile: string | undefined;
  readonly ci: boolean;
  readonly init: boolean;
  readonly dryRun: boolean;
  readonly apply: boolean;
  readonly status: boolean;
  readonly why: string | undefined;
  readonly tags: readonly string[];
  readonly only: readonly string[];
  readonly verbose: boolean;
  readonly update: boolean;
}

const configSourceDescription = `Config source path, HTTPS URL, or GitHub shorthand (gh:owner/repo[@<40-char-commit>][/path/to/config.json]; remote sources can append #sha256=<digest>; bare repos default to ${defaultGitHubConfigPath})`;

const source = Args.text({ name: "config-source" }).pipe(
  Args.optional,
  Args.withDescription(`${configSourceDescription} (default: ${defaultConfigSource})`),
);

const config = Options.optional(Options.text("config").pipe(Options.withAlias("c"))).pipe(
  Options.withDescription(`${configSourceDescription} (default: ${defaultConfigSource})`),
);

const profile = Options.optional(Options.text("profile").pipe(Options.withAlias("p"))).pipe(
  Options.withDescription("Profile/topology surface to apply in headless mode"),
);

const ci = Options.boolean("ci").pipe(
  Options.withDescription("Run non-interactively; requires --profile <name>"),
);

const init = Options.boolean("init").pipe(
  Options.withDescription("Create a minimal starter config at the resolved local path and exit"),
);

const dryRun = Options.boolean("dry-run").pipe(
  Options.withAlias("d"),
  Options.withDescription("Preview changes without installing anything"),
);

const apply = Options.boolean("apply").pipe(
  Options.withDescription(
    "Execute a remote HTTPS config source after review (HTTPS URLs and GitHub shorthand preview by default)",
  ),
);

const status = Options.boolean("status").pipe(
  Options.withDescription(
    "Show a read-only status view for selected items (installed, missing, blocked, updateable)",
  ),
);

const why = Options.optional(Options.text("why")).pipe(
  Options.withDescription(
    "Explain why an item is selected under the active profile and filters (read-only)",
  ),
);

const tags = Options.withDefault(
  Options.text("tags").pipe(Options.withAlias("t"), Options.repeated),
  [],
).pipe(
  Options.withDescription(
    "Filter items by tags and include required dependencies (can be repeated: -t dev -t editor)",
  ),
);

const only = Options.withDefault(
  Options.text("only").pipe(Options.withAlias("o"), Options.repeated),
  [],
).pipe(
  Options.withDescription(
    "Install specific items and include required dependencies (can be repeated: -o neovim -o ripgrep)",
  ),
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
  source,
  config,
  profile,
  ci,
  init,
  dryRun,
  apply,
  status,
  why,
  tags,
  only,
  verbose,
  update,
};

const resolveConfigInput = (
  source: Option.Option<string>,
  config: Option.Option<string>,
): string => {
  if (Option.isSome(source)) {
    return source.value;
  }

  if (Option.isSome(config)) {
    return config.value;
  }

  return defaultConfigSource;
};

export const makeCommand = <E, R>(
  handler: (options: CliOptions) => Effect.Effect<void, E, R>,
): Command.Command<"rig", R, E, Command.Command.ParseConfig<typeof cliOptions>> =>
  Command.make("rig", cliOptions, (opts) =>
    handler({
      config: resolveConfigInput(opts.source, opts.config),
      profile: Option.getOrUndefined(opts.profile),
      ci: opts.ci,
      init: opts.init,
      dryRun: opts.dryRun,
      apply: opts.apply,
      status: opts.status,
      why: Option.getOrUndefined(opts.why),
      tags: opts.tags,
      only: opts.only,
      verbose: opts.verbose,
      update: opts.update,
    }),
  ).pipe(
    Command.withDescription(
      `Declarative system configuration tool

Reads a JSON config source and installs only what's missing. Items are checked
for existence before installing. Use --dry-run to preview local changes.
Remote HTTPS configs and GitHub shorthand preview by default and require --apply to execute.
Bare rig opens the interactive TUI. Headless execution requires --ci --profile <name>.

Quick Start:
  rig --init                                         # Create ./system-config.json
  rig --init ./work-config.json                      # Create a starter config at a custom path
  rig                                                # Open the interactive TUI
  rig --ci --profile macbook --dry-run               # Preview a local config
  rig --ci --profile macbook                         # Apply ./system-config.json
  rig --ci --profile macbook https://example.com/system-config.json
                                                     # Preview a remote config
  rig --ci --profile macbook gh:user/repo            # Preview repo-root ${defaultGitHubConfigPath} from GitHub
  rig --ci --profile macbook gh:user/repo@<40-char-commit>
                                                     # Preview a pinned GitHub config
  rig 'https://example.com/system-config.json#sha256=<digest>'
                                                            # Preview with integrity verification
  rig --ci --profile macbook --apply https://example.com/system-config.json
                                                     # Apply a remote config
  rig --ci --profile macbook --apply gh:user/repo    # Apply a GitHub shorthand config
  rig --ci -p macbook -t dev -t editor               # Install items with dev OR editor tags
  rig --ci -p macbook --status                       # Inspect current item status without mutating
  rig --ci -p macbook --why neovim                   # Explain why 'neovim' is selected
  rig --ci -p macbook --update                       # Update installed items

Docs: See USAGE.md for examples and patterns`,
    ),
  );

export const runCli = <E, R>(
  handler: (options: CliOptions) => Effect.Effect<void, E, R>,
): ((
  args: ReadonlyArray<string>,
) => Effect.Effect<void, E | CliValidationError.ValidationError, R | CliApp.CliApp.Environment>) =>
  Command.run(makeCommand(handler), {
    name: "rig",
    version: "0.1.0",
  });
