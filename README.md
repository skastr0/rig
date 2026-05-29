# rig

A declarative, idempotent macOS/Linux system configuration tool built with Effect and Bun.

Define your system configuration in JSON, and `rig` will install only what's missing. Bare `rig` opens an interactive terminal UI; headless automation uses `--ci --profile <name>`.

## Status

Experimental. rig is useful for local system-configuration workflows, but the CLI behavior, configuration schema, install-source set, TUI behavior, package surface, and release channels may change while the project is in `0.y.z`.

## Quick Start

```bash
# Install (compiles for your host and writes to ~/.local/bin/rig)
bun install && bun run install:local

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

# Preview or apply headlessly
rig --ci --profile macbook --dry-run
rig --ci --profile macbook

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

Requires [Bun](https://bun.sh) 1.0+.

```bash
git clone https://github.com/skastr0/rig.git
cd rig
bun install
bun run install:local
```

`install:local` compiles a binary for your host platform straight into `~/.local/bin/rig` (and ad-hoc codesigns it on macOS). No separate build step needed.

### npm Package

The planned npm package is `@skastr0/rig`, a Bun-native CLI package. It is not published yet.

After the first npm release:

```bash
bunx @skastr0/rig --help
```

### Building Distribution Binaries

To produce binaries for all four supported platforms (`darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64`) under `dist/`:

```bash
bun install --cpu='*' --os='*'
bun run build
```

Use this when you want to upload binaries to a release or copy them to another machine. The extra install command pulls OpenTUI's optional native packages for every target. For installing on the current machine, prefer `bun run install:local`.

Do not publish packages, create release tags, dispatch release workflows, or flip repository visibility until the gates in `docs/publishing.md` have been completed.

## Configuration

Configuration can come from a local JSON file, an HTTPS URL, or GitHub shorthand. If you do not provide a source, `rig` defaults to `./system-config.json`. Remote sources must use HTTPS, whether you pass the final URL directly or let GitHub shorthand resolve it for you.

### GitHub shorthand

`rig` supports a narrow GitHub shorthand that resolves into the existing remote HTTPS loader:

- `gh:owner/repo`
- `gh:owner/repo/path/to/config.json`
- `gh:owner/repo@<40-char-commit>`
- `gh:owner/repo@<40-char-commit>/path/to/config.json`

Resolution is deterministic:

- bare `gh:owner/repo` resolves to `https://raw.githubusercontent.com/owner/repo/HEAD/system-config.json`
- `gh:owner/repo/path/to/config.json` resolves to `https://raw.githubusercontent.com/owner/repo/HEAD/path/to/config.json`
- `gh:owner/repo@<40-char-commit>` resolves to `https://raw.githubusercontent.com/owner/repo/<40-char-commit>/system-config.json`
- pinned refs must be full 40-character Git commit SHAs
- preview output shows the canonical resolved HTTPS URL so you can review exactly what will be fetched

This shorthand is intentionally narrow:

- no mutable branch or tag shorthand such as `@main` or `@v1`
- no query strings
- no arbitrary fragments beyond `#sha256=<64 hex characters>`
- no private repository auth flows
- no non-GitHub providers

If you need a specific branch or tag, pass the full HTTPS raw URL explicitly. If you want stable repeated runs, prefer a pinned commit SHA.

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

For `skills` items, `check` can be omitted. `rig` derives global skill paths for supported agents, such as `~/.codex/skills/<skill>/SKILL.md` for Codex and `~/.config/opencode/skills/<skill>/SKILL.md` for OpenCode. Skills installs run through `env DISABLE_TELEMETRY=1 npx --yes <package> add ... --global --yes`, repeat `--skill` and `--agent` for every configured value, and default to the serial `skills` group unless you set `group` yourself. `mode` defaults to `copy`; set `"mode": "symlink"` to omit the CLI's `--copy` flag.

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

**Script command (preferred for multi-line service installers)**:

```json
{
  "name": "continuwuity-matrix-homeserver",
  "profiles": ["server-home"],
  "tags": ["server", "matrix", "docker"],
  "check": "test -f \"$HOME/.matrix/continuwuity/compose.yml\"",
  "install": {
    "source": "script",
    "interpreter": "zsh",
    "cwd": "~/.matrix/continuwuity",
    "script": "set -euo pipefail\nmkdir -p data\ndocker compose up -d"
  }
}
```

Script commands are written to a temporary file and executed as `interpreter <tempfile>`, so complex Docker or service setup does not need fragile nested shell quoting.

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

Put services that should never install on a daily workstation in a server profile only:

```json
{
  "name": "continuwuity-matrix-homeserver",
  "profiles": ["server-home"],
  "tags": ["server", "matrix", "docker", "tailscale"],
  "check": "test -f \"$HOME/.matrix/continuwuity/compose.yml\" && tailscale serve status 2>/dev/null | grep -q '127.0.0.1:6167'",
  "install": {
    "source": "script",
    "interpreter": "zsh",
    "cwd": "~/.matrix/continuwuity",
    "script": "set -euo pipefail\nmkdir -p data secrets\ncat > compose.yml <<'YAML'\nservices:\n  homeserver:\n    image: forgejo.ellis.link/continuwuation/continuwuity:latest\n    ports:\n      - \"127.0.0.1:6167:6167\"\nYAML\ndocker compose up -d\ntailscale serve --bg --yes http://127.0.0.1:6167"
  },
  "update": {
    "source": "script",
    "interpreter": "zsh",
    "cwd": "~/.matrix/continuwuity",
    "script": "set -euo pipefail\ndocker compose pull\ndocker compose up -d"
  },
  "dependsOn": ["orbstack", "tailscale"]
}
```

Any dependencies, such as `orbstack` or `tailscale` above, must also include `server-home` in their own `profiles` arrays.

```bash
rig --ci --profile server-home --tags server --dry-run
```

## CLI Options

```
rig [options] [config-source]

Options:
  -c, --config <source> Path to a local config file or HTTPS config URL (default: ./system-config.json)
  -p, --profile <name>  Profile/topology surface to apply in headless mode
  --ci                  Run non-interactively; requires --profile <name>
  -d, --dry-run         Show what would be installed without making changes
  --apply               Execute an HTTPS config source after review (remote configs preview by default)
  -t, --tags <tag>      Filter items by tags (can be repeated)
  -o, --only <name>     Install only specific items by name (can be repeated)
  -u, --update          Run update commands and reconcile managed symlinks
  -v, --verbose         Show detailed output
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
```

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
