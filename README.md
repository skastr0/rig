# system-setup

A declarative, idempotent macOS/Linux system configuration tool built with Effect and Bun.

Define your system configuration in JSON, and `system-setup` will install only what's missing.

## Quick Start

```bash
# Install (compiles for your host and writes to ~/.local/bin/system-setup)
bun install && bun run install:local

# Create a config file
cat > system-config.json << 'EOF'
{
  "items": [
    {
      "name": "neovim",
      "check": "which nvim",
      "install": {
        "source": "brew",
        "formula": "neovim"
      }
    }
  ]
}
EOF

# Preview what would be installed
system-setup --dry-run

# Apply local configuration
system-setup

# Review a remote configuration first (default for HTTPS sources)
system-setup https://example.com/system-config.json

# Review a GitHub-hosted configuration first
system-setup gh:user/repo

# Review a pinned GitHub configuration
system-setup gh:user/repo@0123456789abcdef0123456789abcdef01234567

# Review a remote config with recorded integrity
system-setup 'https://example.com/system-config.json#sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

# Apply a reviewed remote configuration
system-setup --apply https://example.com/system-config.json

# Apply a reviewed GitHub shorthand configuration
system-setup --apply gh:user/repo
```

## Installation

### From Source

Requires [Bun](https://bun.sh) 1.0+.

```bash
git clone https://github.com/USER/system-setup.git
cd system-setup
bun install
bun run install:local
```

`install:local` compiles a binary for your host platform straight into `~/.local/bin/system-setup` (and ad-hoc codesigns it on macOS). No separate build step needed.

### Building Distribution Binaries

To produce binaries for all four supported platforms (`darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64`) under `dist/`:

```bash
bun run build
```

Use this when you want to upload binaries to a release or copy them to another machine. For installing on the current machine, prefer `bun run install:local`.

## Configuration

Configuration can come from a local JSON file, an HTTPS URL, or GitHub shorthand. If you do not provide a source, `system-setup` defaults to `./system-config.json`. Remote sources must use HTTPS, whether you pass the final URL directly or let GitHub shorthand resolve it for you.

### GitHub shorthand

`system-setup` supports a narrow GitHub shorthand that resolves into the existing remote HTTPS loader:

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
system-setup gh:owner/repo@0123456789abcdef0123456789abcdef01234567

# Add integrity verification to any remote source
system-setup 'gh:owner/repo@0123456789abcdef0123456789abcdef01234567#sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
system-setup 'https://example.com/system-config.json#sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
```

Integrity mismatches fail closed and report both the expected and observed SHA-256 digests.

### Remote config trust model

Local configs keep the existing contract: apply by default, preview with `--dry-run`.

Remote configs are review-first:
- `system-setup https://example.com/system-config.json` loads the remote config in a non-mutating preview mode
- `system-setup gh:owner/repo` does the same after resolving to the repo root `system-config.json` on GitHub
- preview output shows the source, the selected items, and the install or update steps that would run
- preview output also echoes any active GitHub commit pin or SHA-256 integrity check
- preview output makes shell install commands explicit and distinguishes them from structured installs like `brew`, `git`, `dir`, `symlink`, and `skills`
- `system-setup --apply https://example.com/system-config.json` is the explicit opt-in to execute a remote config
- `system-setup --apply gh:owner/repo/path/to/config.json` is the same explicit opt-in after shorthand resolution

```bash
# Review first
system-setup https://example.com/system-config.json
system-setup gh:owner/repo

# Then apply once you trust it
system-setup --apply https://example.com/system-config.json
system-setup --apply gh:owner/repo/path/to/config.json
```

### Basic Structure

```json
{
  "items": [
    {
      "name": "config-root",
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

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier for the item |
| `check` | Usually | Command or path to verify installation; optional for managed `dir`, `symlink`, and `skills` sources |
| `install` | Yes | Shell command or structured install source |
| `onCheck` | No | Detection strategy: `"exit-code"` (default) or `"path-exists"` |
| `update` | No | Command to update the item; `symlink` sources also use `--update` to replace incorrect existing paths |
| `group` | No | Serial execution group (items in same group run sequentially) |
| `dependsOn` | No | Array of item names that must be installed first |
| `timeout` | No | Per-item timeout in milliseconds for checks, installs, and updates |
| `backup` | No | Path to backup before installing |
| `tags` | No | Array of tags for filtering |

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

For `symlink` items, `--update` means: if `install.path` already exists but is not the desired symlink, system-setup replaces that existing path with the configured symlink. If `backup` is set, that path is backed up before replacement.

**Brew source (preferred for Homebrew)**:
```json
{
  "install": {
    "source": "brew",
    "formula": "neovim"
  }
}
```

```json
{
  "install": {
    "source": "brew",
    "cask": "firefox"
  }
}
```

**Git clone**:
```json
{
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
  "install": {
    "source": "skills",
    "package": "skills@1.5.1",
    "repo": "vercel-labs/agent-skills",
    "ref": "0123456789abcdef0123456789abcdef01234567",
    "skills": ["frontend-design", "skill-creator"],
    "agents": ["codex", "opencode"],
    "mode": "copy"
  },
  "dependsOn": ["nodejs"],
  "tags": ["ai", "skills"]
}
```

For `skills` items, `check` can be omitted. `system-setup` derives global skill paths for supported agents, such as `~/.codex/skills/<skill>/SKILL.md` for Codex and `~/.config/opencode/skills/<skill>/SKILL.md` for OpenCode. Skills installs run through `env DISABLE_TELEMETRY=1 npx --yes <package> add ... --global --yes`, repeat `--skill` and `--agent` for every configured value, and default to the serial `skills` group unless you set `group` yourself. `mode` defaults to `copy`; set `"mode": "symlink"` to omit the CLI's `--copy` flag.

**Shell command (escape hatch)**:
```json
{ "install": "brew install neovim" }
```

### Groups (Serial Execution)

Items with the same `group` run sequentially. Use this for package managers that use lock files:

```json
{
  "items": [
    { "name": "neovim", "group": "brew", "check": "which nvim", "install": "brew install neovim" },
    { "name": "ripgrep", "group": "brew", "check": "which rg", "install": "brew install ripgrep" },
    { "name": "nodejs", "check": "which node", "install": "asdf install nodejs 22" }
  ]
}
```

Here, neovim and ripgrep run sequentially (same group), while nodejs runs in parallel.

### Dependencies

```json
{
  "items": [
    { "name": "homebrew", "check": "which brew", "install": "/bin/bash -c \"$(curl -fsSL ...)\"" },
    { "name": "neovim", "check": "which nvim", "install": "brew install neovim", "dependsOn": ["homebrew"] }
  ]
}
```

If a dependency fails or times out, only its downstream dependents are blocked. Unrelated items continue to run.

### Timeouts

```json
{
  "name": "xcode-tools",
  "check": "xcode-select -p",
  "install": "xcode-select --install",
  "timeout": 1800000
}
```

Timeouts are specified in milliseconds and apply to check, install, and update commands for that item.

### Profiles

Different configurations for different machines:

```json
{
  "profiles": {
    "work": {
      "exclude": ["personal-repos", "gaming-tools"],
      "items": [
        { "name": "slack", "check": "which slack", "install": "brew install --cask slack" }
      ]
    },
    "personal": {
      "exclude": ["work-vpn"],
      "items": []
    }
  },
  "items": [
    { "name": "neovim", "check": "which nvim", "install": "brew install neovim" },
    { "name": "personal-repos", "check": "~/.personal", "install": "git clone ...", "onCheck": "path-exists" }
  ]
}
```

Use with: `system-setup --profile work`

### Backups

Automatically backup files before overwriting:

```json
{
  "name": "nvim-config",
  "check": "~/.config/nvim",
  "onCheck": "path-exists",
  "install": { "source": "git", "repo": "...", "path": "~/.config/nvim" },
  "backup": "~/.config/nvim"
}
```

Backups are saved to `~/.system-setup-backups/<timestamp>/`.

### Tags

Filter items by tags:

```json
{
  "items": [
    { "name": "neovim", "check": "which nvim", "install": "...", "tags": ["editor", "dev"] },
    { "name": "slack", "check": "which slack", "install": "...", "tags": ["communication"] }
  ]
}
```

```bash
system-setup --tags editor        # Only items with "editor" tag
system-setup --tags dev --tags editor  # Items with "dev" OR "editor"
```

## CLI Options

```
system-setup [options] [config-source]

Options:
  -c, --config <source> Path to a local config file or HTTPS config URL (default: ./system-config.json)
  -p, --profile <name>  Profile to apply
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
# Use a custom local config
system-setup ~/my-config.json

# Use an explicit config flag
system-setup --config ~/my-config.json

# Review a remote config first
system-setup https://example.com/system-config.json

# Apply a remote config after review
system-setup --apply https://example.com/system-config.json

# Force preview for a remote config explicitly
system-setup --dry-run https://example.com/system-config.json

# Apply work profile
system-setup --profile work

# Install specific items
system-setup --only neovim --only ripgrep

# Install by tags
system-setup --tags dev
```

## How It Works

1. **Load**: Read and validate the JSON configuration source
2. **Resolve**: Apply profile (exclude items, add profile-specific items)
3. **Plan**: Build dependency graph, topological sort
4. **Detect**: Run check commands to determine current state
5. **Execute**: Install missing items with group-based concurrency and dependency-isolated failure handling
6. **Report**: Show summary of actions taken

## Development

```bash
# Run in development mode
bun run dev -- --dry-run

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
