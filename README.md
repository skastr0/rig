# rig

A declarative, idempotent macOS/Linux system configuration tool built with Effect and Bun.

Define your system configuration in JSON, and `rig` will install only what's missing. Bare `rig` opens an interactive terminal UI; headless automation uses `--ci --profile <name>`.

## Status

Experimental. rig is useful for local system-configuration workflows, but the CLI behavior, configuration schema, install-source set, TUI behavior, package surface, and release channels may change while the project is in `0.y.z`.

## Quick Start

```bash
# Install a development binary without replacing production rig
bun install && bun run install:dev

# Create a config file
cat > system-config.json << 'EOF'
{
  "items": [
    {
      "name": "neovim",
      "profiles": ["macbook"],
      "tags": ["editor", "dev"],
      "check": "which nvim",
      "install": {
        "source": "brew",
        "formula": "neovim"
      }
    }
  ]
}
EOF

# Open the interactive TUI
rig

# Preview or apply a profile headlessly
rig --ci --profile macbook --dry-run
rig --ci --profile macbook

# Preview one technology slice within that profile
rig --ci --profile macbook --tags dev --dry-run

# Inspect status and explain selections before installing anything
rig --ci --profile macbook --status
rig --ci --profile macbook --why neovim

# Review a remote configuration first (default for HTTPS sources)
rig --ci --profile macbook https://example.com/system-config.json

# Review a GitHub-hosted configuration first
rig --ci --profile macbook gh:user/repo

# Review a pinned GitHub configuration
rig --ci --profile macbook gh:user/repo@0123456789abcdef0123456789abcdef01234567

# Review a remote config with recorded integrity
rig --ci --profile macbook 'https://example.com/system-config.json#sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

# Apply a reviewed remote configuration
rig --ci --profile macbook --apply https://example.com/system-config.json

# Apply a reviewed GitHub shorthand configuration
rig --ci --profile macbook --apply gh:user/repo
```

## Installation

### From Source

Requires [Bun](https://bun.sh) 1.3.0+.

```bash
git clone https://github.com/skastr0/rig.git
cd rig
bun install
bun run install:local
```

`install:local` compiles a binary for your host platform straight into `~/.local/bin/rig` (and ad-hoc codesigns it on macOS). No separate build step needed.

For day-to-day development, use `bun run install:dev` instead. It compiles the host binary as `.rig-dev/bin/rig-dev-<platform>-<arch>`, links it as `~/.local/bin/rig-dev`, and leaves the production `rig` command untouched.

### npm Package

The planned npm package is `@skastr0/rig`. It is not published yet.
The package installs a small Node launcher plus a platform-specific prebuilt binary, so users do not need Bun installed to run rig from npm package runners.

After the first npm release:

```bash
npx @skastr0/rig --help
bunx @skastr0/rig --help
pnpm dlx @skastr0/rig --help
```

### Building Distribution Binaries

To produce binaries for all four supported platforms (`darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64`) under `dist/` and the npm platform packages:

```bash
bun install --cpu='*' --os='*'
bun run build
```

Use this when you want to upload binaries to a release or copy them to another machine. The extra install command pulls OpenTUI's optional native packages for every target. For trying local changes without replacing production `rig`, prefer `bun run install:dev`.

Do not publish packages, create release tags, dispatch release workflows, or flip repository visibility until the gates in `docs/publishing.md` have been completed.

## Configuration

Configuration can come from a local JSON file, an HTTPS URL, or GitHub shorthand.

If you do not provide a source, `rig` discovers a local config:

1. walk up from the current directory looking for `system-config.json`
2. if none is found, try `~/system-config.json`
3. otherwise fail with a clear discovery error

`--init` always writes `./system-config.json` in the current directory (or an explicit local path); it does not walk up.

Remote HTTPS URLs and `gh:` shorthand still require an explicit source argument (or alias). There is no `~/.rig/config` pointer file yet.

### GitHub shorthand

`rig` supports a narrow GitHub shorthand:

- `gh:owner/repo`
- `gh:owner/repo/path/to/config.json`
- `gh:owner/repo@<40-char-commit>`
- `gh:owner/repo@<40-char-commit>/path/to/config.json`

Resolution is deterministic:

- bare `gh:owner/repo` targets repository-root `system-config.json` at the default branch (`HEAD` in the raw fallback URL)
- `gh:owner/repo/path/to/config.json` targets that path
- `gh:owner/repo@<40-char-commit>` pins an immutable commit
- pinned refs must be full 40-character Git commit SHAs
- preview output shows the shorthand and the canonical raw HTTPS URL

#### Private repos via GitHub CLI

`gh:` sources prefer the authenticated GitHub CLI:

```bash
gh auth login   # once
rig gh:you/private-dotfiles
rig --apply gh:you/private-dotfiles
```

Load order for `gh:`:

1. `gh api -H "Accept: application/vnd.github.raw" repos/owner/repo/contents/<path>` (uses your `gh` credentials; works for private repos)
2. if `gh` is missing or the CLI request fails, fall back to public `raw.githubusercontent.com` HTTPS

Public repos keep working without `gh`. Private repos require `gh` installed and `gh auth login`.

This shorthand is intentionally narrow:

- no mutable branch or tag shorthand such as `@main` or `@v1`
- no query strings
- no arbitrary fragments beyond `#sha256=<64 hex characters>`
- no non-GitHub providers
- no built-in token env / PAT config beyond whatever `gh` already uses

If you need a specific branch or tag, pass the full HTTPS raw URL explicitly (public only unless you host auth yourself). If you want stable repeated runs, prefer a pinned commit SHA.

### Pinning and integrity

Remote config pinning stays intentionally small:

- GitHub shorthand can pin to an immutable commit with `@<40-char-commit>`
- any remote HTTPS source can record an optional integrity check with `#sha256=<64 hex characters>`
- the integrity fragment is stripped before fetching, so it acts as local verification metadata rather than part of the remote request

That gives one narrow operator story for audited repeated runs:

```bash
# Pin GitHub shorthand to a specific commit
rig gh:owner/repo@0123456789abcdef0123456789abcdef01234567

# Add integrity verification to any remote source
rig 'gh:owner/repo@0123456789abcdef0123456789abcdef01234567#sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
rig 'https://example.com/system-config.json#sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
```

Integrity mismatches fail closed and report both the expected and observed SHA-256 digests.

### Remote config trust model

Local configs keep the existing contract: apply by default, preview with `--dry-run`.

Remote configs are review-first:

- `rig https://example.com/system-config.json` opens the interactive TUI in review mode
- `rig gh:owner/repo` does the same after resolving to the repo root `system-config.json` on GitHub
- headless remote runs require `--ci --profile <name>` and preview by default
- preview output shows the source, the selected items, and the install or update steps that would run
- preview output also echoes any active GitHub commit pin or SHA-256 integrity check
- preview output makes shell and script install commands explicit and distinguishes them from structured installs like `brew`, `git`, `dir`, `symlink`, and `skills`
- `rig --apply https://example.com/system-config.json` is the explicit opt-in that enables the TUI run action for a remote config
- `rig --ci --profile macbook --apply https://example.com/system-config.json` is the headless opt-in
- `rig --apply gh:owner/repo/path/to/config.json` is the same explicit opt-in after shorthand resolution
- remote `--status` also requires `--apply` because status mode executes configured check commands

```bash
# Review first in the TUI
rig https://example.com/system-config.json
rig gh:owner/repo

# Headless remote preview
rig --ci --profile macbook https://example.com/system-config.json

# Then apply once you trust it; without --apply the TUI run key stays disabled
rig --apply https://example.com/system-config.json
rig --ci --profile macbook --apply gh:owner/repo/path/to/config.json
```

### Basic Structure

```json
{
  "items": [
    {
      "name": "config-root",
      "profiles": ["macbook"],
      "tags": ["base", "filesystem"],
      "check": "~/.config",
      "onCheck": "path-exists",
      "install": {
        "source": "dir",
        "path": "~/.config"
      }
    }
  ]
}
```

### Item Fields

| Field       | Required | Description                                                                                           |
| ----------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `name`      | Yes      | Unique identifier for the item                                                                        |
| `profiles`  | Yes      | Topology surfaces where this item belongs, such as `"macbook"` or `"server-home"`                     |
| `tags`      | Yes      | Technology or workflow slices used for filtering, such as `"brew"`, `"editor"`, or `"server"`         |
| `check`     | Usually  | Command or path to verify installation; optional for managed `dir`, `symlink`, and `skills` sources   |
| `install`   | Yes      | Shell command or structured install source                                                            |
| `onCheck`   | No       | Detection strategy: `"exit-code"` (default) or `"path-exists"`                                        |
| `update`    | No       | Command to update the item; `symlink` sources also use `--update` to replace incorrect existing paths |
| `group`     | No       | Serial execution group (items in same group run sequentially)                                         |
| `dependsOn` | No       | Array of item names that must be installed first                                                      |
| `timeout`   | No       | Per-item timeout in milliseconds for checks, installs, and updates                                    |
| `backup`    | No       | Path to backup before installing                                                                      |

### Check Strategies

**exit-code** (default): Run command, exit 0 = installed

```json
{ "check": "which nvim", "onCheck": "exit-code" }
```

**path-exists**: Check if path exists

```json
{ "check": "~/.config/nvim", "onCheck": "path-exists" }
```

### Install Strategies

**Directory (preferred for managed directories)**:

```json
{
  "name": "projects-root",
  "profiles": ["macbook"],
  "tags": ["filesystem", "base"],
  "check": "~/Projects",
  "onCheck": "path-exists",
  "install": {
    "source": "dir",
    "path": "~/Projects"
  }
}
```

**Symlink (preferred for managed links)**:

```json
{
  "name": "zshrc",
  "profiles": ["macbook"],
  "tags": ["dotfiles", "shell"],
  "check": "~/.zshrc",
  "onCheck": "path-exists",
  "install": {
    "source": "symlink",
    "path": "~/.zshrc",
    "target": "~/.dotfiles/.zshrc"
  },
  "backup": "~/.zshrc"
}
```

For `symlink` items, `--update` means: if `install.path` already exists but is not the desired symlink, rig replaces that existing path with the configured symlink. If `backup` is set, that path is backed up before replacement.

**Brew source (preferred for Homebrew)**:

```json
{
  "name": "neovim",
  "profiles": ["macbook"],
  "tags": ["brew", "editor"],
  "check": "which nvim",
  "install": {
    "source": "brew",
    "formula": "neovim"
  }
}
```

```json
{
  "name": "firefox",
  "profiles": ["macbook"],
  "tags": ["brew", "browser"],
  "check": "/Applications/Firefox.app",
  "onCheck": "path-exists",
  "install": {
    "source": "brew",
    "cask": "firefox"
  }
}
```

**Git clone**:

```json
{
  "name": "dotfiles",
  "profiles": ["macbook"],
  "tags": ["dotfiles", "git"],
  "check": "~/.dotfiles",
  "onCheck": "path-exists",
  "install": {
    "source": "git",
    "repo": "https://github.com/user/dotfiles.git",
    "path": "~/.dotfiles",
    "branch": "main",
    "sparse": ["nvim", "zsh"]
  }
}
```

**Skills source (preferred for agent skills)**:

```json
{
  "name": "agent-skills",
  "profiles": ["macbook"],
  "tags": ["ai", "skills"],
  "install": {
    "source": "skills",
    "package": "skills@1.5.1",
    "repo": "vercel-labs/agent-skills",
    "ref": "0123456789abcdef0123456789abcdef01234567",
    "skills": ["frontend-design", "skill-creator"],
    "agents": ["codex", "opencode"],
    "mode": "copy"
  },
  "dependsOn": ["nodejs"]
}
```

For `skills` items, `check` can be omitted. `rig` derives global skill paths for supported agents, such as `~/.codex/skills/<skill>/SKILL.md` for Codex and `~/.config/opencode/skills/<skill>/SKILL.md` for OpenCode. Skills installs run through `env DISABLE_TELEMETRY=1 npx --yes <package> add <repo>#<ref> --global --yes`, repeat `--skill` and `--agent` for every configured value, and default to the serial `skills` group unless you set `group` yourself. `mode` defaults to `copy`; set `"mode": "symlink"` to omit the CLI's `--copy` flag.

**Shell command (escape hatch)**:

```json
{
  "name": "neovim",
  "profiles": ["macbook"],
  "tags": ["brew", "editor"],
  "check": "which nvim",
  "install": "brew install neovim"
}
```

**Script command (preferred for multi-line setup)**:

```json
{
  "name": "workspace-marker",
  "profiles": ["server-home"],
  "tags": ["server", "bootstrap"],
  "check": "~/.local/share/rig/server-home",
  "onCheck": "path-exists",
  "install": {
    "source": "script",
    "interpreter": "zsh",
    "cwd": "~/.local/share",
    "script": "set -euo pipefail\nmkdir -p rig/server-home\nprintf 'managed by rig\\n' > rig/server-home/README.txt"
  }
}
```

Script commands are written to a temporary file and executed as `interpreter <tempfile>`, so multi-step setup does not need fragile nested shell quoting.

### Groups (Serial Execution)

Items with the same `group` run sequentially. Use this for package managers that use lock files:

```json
{
  "items": [
    {
      "name": "neovim",
      "profiles": ["macbook"],
      "tags": ["brew", "editor"],
      "group": "brew",
      "check": "which nvim",
      "install": "brew install neovim"
    },
    {
      "name": "ripgrep",
      "profiles": ["macbook"],
      "tags": ["brew", "dev"],
      "group": "brew",
      "check": "which rg",
      "install": "brew install ripgrep"
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

Here, neovim and ripgrep run sequentially (same group), while nodejs runs in parallel.

### Dependencies

```json
{
  "items": [
    {
      "name": "homebrew",
      "profiles": ["macbook"],
      "tags": ["brew", "bootstrap"],
      "check": "which brew",
      "install": "/bin/bash -c \"$(curl -fsSL ...)\""
    },
    {
      "name": "neovim",
      "profiles": ["macbook"],
      "tags": ["brew", "editor"],
      "check": "which nvim",
      "install": "brew install neovim",
      "dependsOn": ["homebrew"]
    }
  ]
}
```

If a dependency fails or times out, only its downstream dependents are blocked. Unrelated items continue to run.

### Timeouts

```json
{
  "name": "xcode-tools",
  "profiles": ["macbook"],
  "tags": ["xcode", "developer-tools"],
  "check": "xcode-select -p",
  "install": "xcode-select --install",
  "timeout": 1800000
}
```

Timeouts are specified in milliseconds and apply to check, install, and update commands for that item.

### Profiles

Profiles are topology surfaces: where an item is allowed to run. Tags are technology or workflow slices: what kind of thing an item is. The same item can belong to multiple profiles and multiple tags.

```json
{
  "items": [
    {
      "name": "homebrew",
      "profiles": ["macbook"],
      "tags": ["brew", "bootstrap"],
      "check": "which brew",
      "install": "/bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
    },
    {
      "name": "tailscale",
      "profiles": ["macbook", "server-home"],
      "tags": ["networking", "vpn"],
      "check": "which tailscale",
      "install": { "source": "brew", "cask": "tailscale" },
      "dependsOn": ["homebrew"]
    }
  ]
}
```

Bare `rig` asks for a profile interactively. Headless runs must name one:

```bash
rig --ci --profile macbook
rig --ci --profile server-home --dry-run
```

### Backups

Automatically backup files before overwriting:

```json
{
  "name": "nvim-config",
  "profiles": ["macbook"],
  "tags": ["editor", "dotfiles"],
  "check": "~/.config/nvim",
  "onCheck": "path-exists",
  "install": {
    "source": "git",
    "repo": "https://github.com/username/nvim-config.git",
    "path": "~/.config/nvim"
  },
  "backup": "~/.config/nvim"
}
```

Backups are saved to `~/.rig-backups/<timestamp>/`.

### Tags

Filter items by tags:

```json
{
  "items": [
    {
      "name": "neovim",
      "profiles": ["macbook"],
      "check": "which nvim",
      "install": "...",
      "tags": ["editor", "dev"]
    },
    {
      "name": "slack",
      "profiles": ["macbook"],
      "check": "which slack",
      "install": "...",
      "tags": ["communication"]
    }
  ]
}
```

```bash
rig --ci --profile macbook --tags editor
rig --ci --profile macbook --tags dev --tags editor
```

Tag filters are evaluated inside the selected profile first, then dependencies are included. Dependencies must also be available on the active profile, so shared prerequisites should list every profile that can depend on them.

### Server-Only Services

Put services that should never install on a daily workstation in a server profile only. Keep shared prerequisites on every profile that can depend on them, then put the service-specific installer on the server surface.

```json
{
  "items": [
    {
      "name": "homebrew",
      "profiles": ["macbook", "server-home"],
      "tags": ["brew", "bootstrap"],
      "check": "which brew",
      "install": "/bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
    },
    {
      "name": "caddy",
      "profiles": ["server-home"],
      "tags": ["server", "web"],
      "check": "which caddy",
      "install": { "source": "brew", "formula": "caddy" },
      "group": "brew",
      "dependsOn": ["homebrew"]
    },
    {
      "name": "caddy-site",
      "profiles": ["server-home"],
      "tags": ["server", "web", "service"],
      "check": "~/.config/caddy/Caddyfile",
      "onCheck": "path-exists",
      "install": {
        "source": "script",
        "interpreter": "zsh",
        "cwd": "~",
        "script": "set -euo pipefail\nmkdir -p .config/caddy\nprintf ':8080\\nrespond \"ok\"\\n' > .config/caddy/Caddyfile"
      },
      "dependsOn": ["caddy"]
    }
  ]
}
```

The `server-home` profile prevents both service items from appearing on `macbook`. The `server`, `web`, and `service` tags let you preview or apply a smaller service slice after choosing that profile.

```bash
rig --ci --profile server-home --tags server --dry-run
rig --ci --profile server-home --tags service --only caddy-site --dry-run
```

## CLI Options

```
rig [options] [config-source]

Options:
  -c, --config <source> Local path, HTTPS URL, or gh:owner/repo (omit to walk up for system-config.json, then ~/system-config.json)
  -p, --profile <name>  Profile/topology surface to apply in headless mode
  --ci                  Run non-interactively; requires --profile <name>
  --init                Create a minimal starter config at the resolved local path and exit
  -d, --dry-run         Show what would be installed without making changes
  --apply               Execute an HTTPS config source after review (remote configs preview by default)
  --status              Show selected item status without installing or updating items
  --why <name>          Explain why an item is selected by the active profile and filters
  -t, --tags <tag>      Filter items by tags (can be repeated)
  -o, --only <name>     Install only specific items by name (can be repeated)
  -u, --update          Run update commands and reconcile managed symlinks
  -v, --verbose         Show detailed output
  --completions <shell> Generate shell completions
  --log-level <level>   Set the Effect runtime log level
  --help                Show help
  --version             Show version
```

### Examples

```bash
# Open the interactive TUI with a custom local config
rig ~/my-config.json

# Use an explicit config flag
rig --config ~/my-config.json

# Review a remote config first in headless mode
rig --ci --profile macbook https://example.com/system-config.json

# Apply a remote config after review
rig --ci --profile macbook --apply https://example.com/system-config.json

# Force preview for a remote config explicitly
rig --ci --profile macbook --dry-run https://example.com/system-config.json

# Apply macbook profile headlessly
rig --ci --profile macbook

# Install specific items
rig --ci --profile macbook --only neovim --only ripgrep

# Install by tags
rig --ci --profile macbook --tags dev

# Inspect current status or explain one selected item
rig --ci --profile macbook --status
rig --ci --profile macbook --why neovim
```

`--status` does not install or update items, but it does execute each selected item's configured check command to determine current state. Keep check commands idempotent.

## How It Works

1. **Load**: Read and validate the JSON configuration source
2. **Resolve**: Select items in the chosen profile, then apply tag or item filters and dependency expansion
3. **Plan**: Build dependency graph, topological sort
4. **Detect**: Run check commands to determine current state
5. **Execute**: Install missing items with group-based concurrency and dependency-isolated failure handling
6. **Report**: Show summary of actions taken

## Development

```bash
# Run in development mode
bun run dev -- --ci --profile macbook --dry-run

# Install and smoke the development binary
bun run install:dev
rig-dev --help

# Run tests
bun run test

# Type check
bun run typecheck

# Lint
bun run lint

# Format
bun run format

# All validation
bun run validate
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed design decisions.

## License

MIT
