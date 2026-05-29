# Rig - Architecture

A declarative, idempotent macOS system configuration tool built with Effect and Bun.

## Design Principles

1. **Declarative** - JSON config describes desired state, not steps
2. **Idempotent** - Safe to run multiple times; detects current state
3. **Stateless** - No database; derives state from system inspection
4. **Fail-fast** - Stop on first error (no partial states)
5. **Type-safe** - Effect Schema validates config at runtime

## Core Decisions

### ADR-001: Generic Item Schema (No Type-Specific Handlers)

**Context**: Initial design used discriminated unions with types like `brew-package`, `asdf-plugin`, etc., each with dedicated handlers.

**Decision**: Use a single generic `SystemItem` schema where users define their own `check`, optional `update`, and either a shell install command or a small set of structured install sources.

**Rationale**:

- Removes coupling to specific package managers
- Users can define any installation method
- Simpler codebase (no handler registry)
- More flexible for edge cases

**Structure**:

```typescript
type SystemItem = {
  name: string; // Unique identifier
  profiles: string[]; // Topology surfaces where the item is eligible
  tags: string[]; // Technology/workflow slices for filtering
  check?: string; // Command or path to verify installation; optional for managed sources
  onCheck?: "exit-code" | "path-exists"; // Detection strategy
  install:
    | string
    | BrewInstall
    | GitInstall
    | DirInstall
    | SymlinkInstall
    | SkillsInstall
    | ScriptCommand;
  update?: string | ScriptCommand; // Optional update command
  group?: string; // Serial execution group
  dependsOn?: string[]; // Dependency ordering
  backup?: string; // Path to backup before install
};
```

### ADR-002: Install Strategy Discriminated Union

**Context**: Most items install via shell command, but a few high-frequency cases need structured handling for clarity and safer defaults.

**Decision**: `install` is a union of:

- `string` for shell commands (escape hatch)
- `{ source: "brew", ... }` for Homebrew installs
- `{ source: "git", ... }` for clones and sparse checkouts
- `{ source: "dir", path }` for directory creation
- `{ source: "symlink", path, target }` for managed symlinks
- `{ source: "skills", ... }` for Vercel Skills CLI installs across one or more agents
- `{ source: "script", interpreter, script, cwd? }` for multiline scripts without fragile shell quoting

**Rationale**:

- Shell commands still cover edge cases
- Brew installs need safe serialization and clearer config
- Git clones need structured handling for sparse checkout, branch selection, and path expansion
- Directory and symlink items encode simple filesystem intent directly instead of wrapping shell commands
- Skills installs need reproducible `npx skills add` invocations, derived checks, telemetry suppression, and serialized writes to agent skill directories
- Script installs keep complex service setup readable, previewable, and safer to execute than a long nested `sh -c` string
- Keeps the schema small while making the common cases explicit

### ADR-003: Group-Based Serial Execution

**Context**: Homebrew uses a lock file and fails with concurrent access. Other tools may have similar constraints.

**Decision**: Items with the same `group` field run serially; different groups run in parallel.

**Rationale**:

- No hardcoded knowledge of brew/asdf internals
- User controls concurrency via config
- Implemented via per-group Semaphore with permits=1
- Items without `group` run fully parallel

**Example**:

```json
{
  "items": [
    {
      "name": "neovim",
      "profiles": ["macbook"],
      "tags": ["brew", "editor"],
      "check": "which nvim",
      "group": "brew",
      "install": "brew install neovim"
    },
    {
      "name": "zellij",
      "profiles": ["macbook"],
      "tags": ["brew", "terminal"],
      "check": "which zellij",
      "group": "brew",
      "install": "brew install zellij"
    },
    {
      "name": "nodejs",
      "profiles": ["macbook"],
      "tags": ["runtime", "node"],
      "check": "which node",
      "install": "asdf install nodejs 22"
    }
  ]
}
```

### ADR-004: Detection via Check Command

**Context**: Need to determine if an item is already installed to achieve idempotency.

**Decision**: Each item has a `check` field. Based on `onCheck`:

- `exit-code` (default): Run command; exit 0 = installed
- `path-exists`: Check if path exists

Structured `dir`, `symlink`, and `skills` install sources also perform install-specific filesystem checks so they can detect conflicts, symlink drift, and already-installed agent skills explicitly.

**Rationale**:

- User controls detection logic
- Works for any tool (no built-in detection code)
- Simple and predictable
- Extensible (can add more `onCheck` strategies later)

### ADR-005: Effect as Core Dependency

**Context**: The tool needs concurrent execution, dependency injection, error handling, and schema validation.

**Decision**: Use Effect ecosystem:

- `effect` - Core effects, Semaphore, Schema
- `@effect/cli` - CLI parsing
- `@effect/platform-bun` - Bun runtime integration

**Rationale**:

- Type-safe concurrency (Semaphore, Effect.forEach)
- Dependency injection via Layers
- Schema validation with detailed errors
- Structured error handling (TaggedError)
- Reference implementation available (tasks-tui)

### ADR-006: Profile and Tag Selection

**Context**: Different machines and environments need different topology surfaces, while operators also need technology slices such as `brew`, `runtime`, `server`, or `editor` that can cut across those surfaces.

**Decision**: Each item declares both:

- `profiles`: the surfaces where the item is eligible, such as `macbook`, `work`, `personal`, or `server-home`
- `tags`: the technology/workflow slices the item belongs to, such as `brew`, `node`, `matrix`, or `containers`

Bare `rig` is interactive when attached to a TTY: the TUI asks for a profile, optional tag filters, and execution options. Headless usage fails closed and requires `--ci --profile <name>`.

**Structure**:

```json
{
  "items": [
    {
      "name": "homebrew",
      "profiles": ["macbook", "work"],
      "tags": ["brew", "essential"],
      "check": "which brew",
      "install": "..."
    },
    {
      "name": "continuwuity-matrix-homeserver",
      "profiles": ["server-home"],
      "tags": ["server", "matrix", "docker"],
      "check": "...",
      "install": { "source": "script", "interpreter": "/bin/zsh", "script": "..." }
    }
  ]
}
```

**Resolution**:

1. Load and validate all declared items
2. Collect available profiles and tags from item metadata
3. Select direct items matching the requested profile and tag filters
4. Expand dependencies by item name, requiring every dependency to be available on the active profile
5. Preserve dependency metadata so the UI and dry-run output can distinguish direct matches and dependency matches

### ADR-007: Backup Before Overwrite

**Context**: Dotfiles/configs may have local changes that shouldn't be lost.

**Decision**: Items can specify `backup` path. Before install, the tool:

1. Creates timestamped backup dir (e.g., `~/.rig-backups/2024-01-15T10-30-00/`)
2. Copies existing file/directory to backup
3. Proceeds with install

**Rationale**:

- Non-destructive by default
- User can recover if needed
- Timestamp prevents overwriting backups

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI Layer                            │
│  @effect/cli + OpenTUI: --config, --profile, --tags, --ci  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Engine Layer                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   Planner   │  │  Executor   │  │  Reporter   │        │
│  │ (topo sort) │  │ (Semaphore) │  │ (dry-run)   │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Services Layer                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│  │ ShellService │ │ GitService   │ │BackupService │       │
│  │ (Bun.spawn)  │ │ (clone)      │ │ (copy)       │       │
│  └──────────────┘ └──────────────┘ └──────────────┘       │
│  ┌──────────────┐                                          │
│  │ConfigService │ (load, validate, resolve selection)      │
│  └──────────────┘                                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Runtime Layer                            │
│           ManagedRuntime + AppLayer composition             │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

```
1. CLI parses args or launches the interactive TUI
   │
   ▼
2. ConfigService loads JSON, validates with Schema, resolves profile/tag selection
   │
   ▼
3. Planner builds dependency graph, topological sort
   │
   ▼
4. Executor detects current state (check commands)
   │
   ▼
5. Reporter shows plan (dry-run) or Executor installs missing items
   │
   ▼
6. Items execute with group-based concurrency control
```

## File Structure

```
rig/
├── src/
│   ├── index.ts              # CLI entry (@effect/cli)
│   ├── appHandler.ts         # Headless validation or interactive TUI dispatch
│   ├── runtime.ts            # ManagedRuntime (single instance)
│   ├── errors.ts             # Tagged errors
│   ├── tui/                  # React/OpenTUI profile, tag, review, and run flow
│   ├── schema/
│   │   ├── config.ts         # Effect Schema definitions
│   ├── services/
│   │   ├── ConfigService.ts  # Load and validate config files
│   │   ├── ShellService.ts   # Command execution with timeout
│   │   ├── BackupService.ts  # Backup before overwrite
│   │   ├── GitService.ts     # Git clone operations
│   │   └── AppLayer.ts       # Layer composition
│   └── engine/
│       ├── Planner.ts        # Dependency graph + topological sort
│       ├── Executor.ts       # Concurrent execution with groups
│       └── Reporter.ts       # Progress output, dry-run display
├── package.json
├── tsconfig.json
└── example-config.json
```

## Error Handling

All errors are tagged using `Data.TaggedError`:

```typescript
class ConfigError extends Data.TaggedError("ConfigError")<{ message: string }>
class ShellError extends Data.TaggedError("ShellError")<{ command: string; exitCode: number; stderr: string }>
class GitError extends Data.TaggedError("GitError")<{ repo: string; reason: string }>
class ValidationError extends Data.TaggedError("ValidationError")<{ issues: string[] }>
class CycleError extends Data.TaggedError("CycleError")<{ cycle: string[] }>
```

Fail-fast behavior: First error stops execution. No partial states.

## Security Considerations

- Commands come from user-controlled config file
- No command interpolation/injection (commands run as-is)
- Backup before destructive operations
- Dry-run mode for preview
