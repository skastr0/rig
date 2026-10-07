import { Args, CliApp, Command, Options, ValidationError as CliValidationError } from "@effect/cli";
import { Effect, Option } from "effect";
import { defaultConfigSource, defaultGitHubConfigPath } from "./configSource.js";

declare const APP_BINARY_NAME: string | undefined;

export interface CliOptions {
  /** Explicit config source; undefined triggers walk-up discovery for system-config.json. */
  readonly config: string | undefined;
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

const configSourceDescription = `Config source path, HTTPS URL, or GitHub shorthand (gh:owner/repo[@40-char-commit][/path/to/config.json]; remote sources can append #sha256=digest; bare repos default to ${defaultGitHubConfigPath}; private gh: sources use authenticated GitHub CLI when available). When omitted, use ~/.rig/config.json defaultSource if set, otherwise walk up for ${defaultConfigSource}, then try ~/${defaultGitHubConfigPath}`;

const source = Args.text({ name: "config-source" }).pipe(
  Args.optional,
  Args.withDescription(configSourceDescription),
);

const config = Options.optional(Options.text("config").pipe(Options.withAlias("c"))).pipe(
  Options.withDescription(configSourceDescription),
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
  Options.withDescription("Show selected item status without installing or updating items"),
);

const why = Options.optional(Options.text("why")).pipe(
  Options.withDescription("Explain why an item is selected under the active profile and filters"),
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

const defaultBinaryName = (): string =>
  typeof APP_BINARY_NAME === "string" && APP_BINARY_NAME.length > 0 ? APP_BINARY_NAME : "rig";

const resolveConfigInput = (
  source: Option.Option<string>,
  config: Option.Option<string>,
): string | undefined => {
  if (Option.isSome(source)) {
    return source.value;
  }

  if (Option.isSome(config)) {
    return config.value;
  }

  return undefined;
};

export const makeCommand = <E, R>(
  handler: (options: CliOptions) => Effect.Effect<void, E, R>,
  binaryName = defaultBinaryName(),
): Command.Command<string, R, E, Command.Command.ParseConfig<typeof cliOptions>> =>
  Command.make(binaryName, cliOptions, (opts) =>
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
Private gh:owner/repo sources load via authenticated GitHub CLI (\`gh api\`) when available.
Bare ${binaryName} uses ~/.rig/config.json defaultSource when set, otherwise walks up for ${defaultConfigSource} (then ~/${defaultGitHubConfigPath}), and opens the interactive TUI.
Headless execution requires --ci --profile <name>.

Quick Start:
  ${binaryName} --init                                         # Create ./system-config.json
  ${binaryName} --init ./work-config.json                      # Create a starter config at a custom path
  ${binaryName}                                                # Discover config + open the interactive TUI
  ${binaryName} --ci --profile macbook --dry-run               # Preview a discovered/local config
  ${binaryName} --ci --profile macbook                         # Apply discovered ${defaultConfigSource}
  ${binaryName} --ci --profile macbook https://example.com/system-config.json
                                                     # Preview a remote config
  ${binaryName} --ci --profile macbook gh:user/repo            # Preview repo-root ${defaultGitHubConfigPath} from GitHub
  ${binaryName} --ci --profile macbook gh:user/repo@<40-char-commit>
                                                     # Preview a pinned GitHub config
  ${binaryName} 'https://example.com/system-config.json#sha256=<digest>'
                                                            # Preview with integrity verification
  ${binaryName} --ci --profile macbook --apply https://example.com/system-config.json
                                                     # Apply a remote config
  ${binaryName} --ci --profile macbook --apply gh:user/private-repo
                                                     # Apply a private GitHub config via gh auth
  ${binaryName} --ci -p macbook -t dev -t editor               # Install items with dev OR editor tags
  ${binaryName} --ci -p macbook --status                       # Inspect current item status without installing
  ${binaryName} --ci -p macbook --why neovim                   # Explain why 'neovim' is selected
  ${binaryName} --ci -p macbook --update                       # Update installed items

Docs: See USAGE.md for examples and patterns`,
    ),
  );

export const runCli = <E, R>(
  handler: (options: CliOptions) => Effect.Effect<void, E, R>,
  binaryName = defaultBinaryName(),
): ((
  args: ReadonlyArray<string>,
) => Effect.Effect<void, E | CliValidationError.ValidationError, R | CliApp.CliApp.Environment>) =>
  Command.run(makeCommand(handler, binaryName), {
    name: binaryName,
    version: "0.1.4",
  });
