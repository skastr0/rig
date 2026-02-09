# system-setup

A declarative, idempotent macOS/Linux system configuration tool built with Effect and Bun.

Define your system configuration in JSON, and `system-setup` will install only what's missing.

## Quick Start

```bash
# Install
bun run build && bun run install:local

# Create a config file
cat > system-config.json << 'EOF'
{
  "items": [
    {
      "name": "neovim",
      "check": "which nvim",
      "install": "brew install neovim",
      "group": "brew"
    }
  ]
}
EOF

# Preview what would be installed
system-setup --dry-run

# Apply configuration
system-setup
```

## Installation

### From Source

Requires [Bun](https://bun.sh) 1.0+.

```bash
git clone https://github.com/USER/system-setup.git
cd system-setup
bun install
bun run build
bun run install:local
```

This installs the binary to `~/.local/bin/system-setup`.

### Manual Installation

```bash
bun run build
cp dist/system-setup-darwin-arm64 ~/.local/bin/system-setup  # adjust for your platform
chmod +x ~/.local/bin/system-setup
```

## Configuration

Configuration is a JSON file (default: `./system-config.json`).

### Basic Structure

```json
{
  "items": [
    {
      "name": "neovim",
      "check": "which nvim",
      "install": "brew install neovim"
    }
  ]
}
```

### Item Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier for the item |
| `check` | Yes | Command or path to verify installation |
| `install` | Yes | Shell command or git config to install |
| `onCheck` | No | Detection strategy: `"exit-code"` (default) or `"path-exists"` |
| `update` | No | Command to update the item |
| `group` | No | Serial execution group (items in same group run sequentially) |
| `dependsOn` | No | Array of item names that must be installed first |
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

**Shell command**:
```json
{ "install": "brew install neovim" }
```

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
system-setup [options]

Options:
  -c, --config <path>   Path to configuration file (default: ./system-config.json)
  -p, --profile <name>  Profile to apply
  -d, --dry-run         Show what would be installed without making changes
  -t, --tags <tag>      Filter items by tags (can be repeated)
  -o, --only <name>     Install only specific items by name (can be repeated)
  -v, --verbose         Show detailed output
  --help                Show help
  --version             Show version
```

### Examples

```bash
# Use custom config
system-setup -c ~/my-config.json

# Preview changes
system-setup --dry-run

# Apply work profile
system-setup --profile work

# Install specific items
system-setup --only neovim --only ripgrep

# Install by tags
system-setup --tags dev
```

## How It Works

1. **Load**: Read and validate JSON configuration
2. **Resolve**: Apply profile (exclude items, add profile-specific items)
3. **Plan**: Build dependency graph, topological sort
4. **Detect**: Run check commands to determine current state
5. **Execute**: Install missing items with group-based concurrency
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
