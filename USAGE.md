# rig Usage Guide

This guide covers common patterns and real-world examples for configuring your system with `rig`.

## Table of Contents

- [Getting Started](#getting-started)
- [Configuration Patterns](#configuration-patterns)
- [Package Manager Examples](#package-manager-examples)
- [Dotfiles Management](#dotfiles-management)
- [Development Environment Setup](#development-environment-setup)
- [Multi-Machine Configuration](#multi-machine-configuration)
- [Advanced Patterns](#advanced-patterns)
- [Troubleshooting](#troubleshooting)

## Getting Started

### Your First Configuration

Create `system-config.json` in your project or home directory:

```json
{
  "items": [
    {
      "name": "neovim",
      "profiles": ["macbook"],
      "tags": ["editor", "dev"],
      "check": "which nvim",
      "install": "brew install neovim",
      "group": "brew"
    }
  ]
}
```

Run:

```bash
# Open the interactive TUI
rig

# See what would be installed in headless mode
rig --ci --profile macbook --dry-run

# Actually install in headless mode
rig --ci --profile macbook
```

### Understanding the Output

```
Execution Plan:

  Level 1: homebrew
  Level 2: neovim, ripgrep, fzf
  Level 3: nvim-config

  Total: 5 items

  ✓ homebrew → already installed
  ✓ neovim → installed
  ✓ ripgrep → already installed
  ✓ fzf → installed
  ✓ nvim-config → installed (backed up)

Summary:
  ✓ 3 installed
  ✓ 2 already installed
  → 1 files backed up
```

**Levels** show dependency order - items in the same level can run in parallel.

## Configuration Patterns

### Pattern 1: Simple Tools

For standalone tools with no dependencies:

```json
{
  "items": [
    {
      "name": "ripgrep",
      "profiles": ["macbook"],
      "tags": ["brew", "dev"],
      "check": "which rg",
      "install": "brew install ripgrep",
      "group": "brew"
    },
    {
      "name": "fd",
      "profiles": ["macbook"],
      "tags": ["brew", "dev"],
      "check": "which fd",
      "install": "brew install fd",
      "group": "brew"
    },
    {
      "name": "bat",
      "profiles": ["macbook"],
      "tags": ["brew", "dev"],
      "check": "which bat",
      "install": "brew install bat",
      "group": "brew"
    },
    {
      "name": "eza",
      "profiles": ["macbook"],
      "tags": ["brew", "shell"],
      "check": "which eza",
      "install": "brew install eza",
      "group": "brew"
    },
    {
      "name": "zoxide",
      "profiles": ["macbook"],
      "tags": ["brew", "shell"],
      "check": "which zoxide",
      "install": "brew install zoxide",
      "group": "brew"
    }
  ]
}
```

### Pattern 2: Tool with Configuration

When a tool needs its config files:

```json
{
  "items": [
    {
      "name": "neovim",
      "profiles": ["macbook"],
      "tags": ["brew", "editor"],
      "check": "which nvim",
      "install": "brew install neovim",
      "group": "brew"
    },
    {
      "name": "nvim-config",
      "profiles": ["macbook"],
      "tags": ["editor", "dotfiles"],
      "check": "~/.config/nvim/init.lua",
      "onCheck": "path-exists",
      "install": {
        "source": "git",
        "repo": "https://github.com/username/nvim-config.git",
        "path": "~/.config/nvim"
      },
      "dependsOn": ["neovim"],
      "backup": "~/.config/nvim"
    }
  ]
}
```

### Pattern 3: Language Runtime with Version Manager

```json
{
  "items": [
    {
      "name": "asdf",
      "profiles": ["macbook"],
      "tags": ["runtime", "version-manager"],
      "check": "which asdf",
      "install": "brew install asdf",
      "group": "brew"
    },
    {
      "name": "nodejs-plugin",
      "profiles": ["macbook"],
      "tags": ["runtime", "node"],
      "check": "asdf plugin list | grep -q nodejs",
      "install": "asdf plugin add nodejs",
      "dependsOn": ["asdf"]
    },
    {
      "name": "nodejs-22",
      "profiles": ["macbook"],
      "tags": ["runtime", "node"],
      "check": "asdf list nodejs | grep -q 22",
      "install": "asdf install nodejs 22 && asdf global nodejs 22",
      "dependsOn": ["nodejs-plugin"]
    }
  ]
}
```

### Pattern 4: Conditional Installation

Profiles are topology surfaces, such as `macbook`, `workstation`, or `server-home`. Tags are technology or workflow slices, such as `editor`, `devops`, or `server`. Every item declares both.

```json
{
  "items": [
    {
      "name": "neovim",
      "profiles": ["macbook"],
      "check": "which nvim",
      "install": "...",
      "tags": ["editor", "essential"]
    },
    {
      "name": "emacs",
      "profiles": ["macbook"],
      "check": "which emacs",
      "install": "...",
      "tags": ["editor"]
    },
    {
      "name": "vscode",
      "profiles": ["macbook"],
      "check": "which code",
      "install": "...",
      "tags": ["editor", "gui"]
    },
    {
      "name": "docker",
      "profiles": ["macbook", "server-home"],
      "check": "which docker",
      "install": "...",
      "tags": ["devops"]
    },
    {
      "name": "kubectl",
      "profiles": ["macbook"],
      "check": "which kubectl",
      "install": "...",
      "tags": ["devops", "k8s"]
    }
  ]
}
```

```bash
rig --ci --profile macbook --tags essential
rig --ci --profile macbook --tags editor
rig --ci --profile server-home --tags devops
```

## Package Manager Examples

### Homebrew (macOS)

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
      "name": "neovim",
      "profiles": ["macbook"],
      "tags": ["brew", "editor"],
      "check": "which nvim",
      "install": "brew install neovim",
      "update": "brew upgrade neovim",
      "group": "brew",
      "dependsOn": ["homebrew"]
    },
    {
      "name": "firefox",
      "profiles": ["macbook"],
      "tags": ["brew", "browser"],
      "check": "/Applications/Firefox.app",
      "onCheck": "path-exists",
      "install": "brew install --cask firefox",
      "group": "brew",
      "dependsOn": ["homebrew"]
    }
  ]
}
```

**Important**: For string-based Homebrew commands, use `"group": "brew"`; native brew source items serialize automatically.

### Native Brew Source

You can migrate from string commands to the native brew source for safer defaults and clearer config.

Before:

```json
{
  "name": "neovim",
  "profiles": ["macbook"],
  "tags": ["brew", "editor"],
  "check": "which nvim",
  "install": "brew install neovim",
  "group": "brew"
}
```

After:

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

Native brew source also supports casks and taps:

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

```json
{
  "name": "nightly-neovim",
  "profiles": ["macbook"],
  "tags": ["brew", "editor"],
  "check": "which nvim",
  "install": {
    "source": "brew",
    "formula": "custom/tap/neovim-nightly",
    "tap": "custom/tap",
    "args": ["--HEAD"]
  }
}
```

### APT (Debian/Ubuntu)

```json
{
  "items": [
    {
      "name": "build-essential",
      "profiles": ["server"],
      "tags": ["apt", "build-tools"],
      "check": "dpkg -l build-essential | grep -q ^ii",
      "install": "sudo apt-get update && sudo apt-get install -y build-essential",
      "group": "apt"
    },
    {
      "name": "neovim",
      "profiles": ["server"],
      "tags": ["apt", "editor"],
      "check": "which nvim",
      "install": "sudo apt-get install -y neovim",
      "group": "apt"
    }
  ]
}
```

### Cargo (Rust)

```json
{
  "items": [
    {
      "name": "rust",
      "profiles": ["macbook"],
      "tags": ["rust", "runtime"],
      "check": "which rustc",
      "install": "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"
    },
    {
      "name": "cargo-watch",
      "profiles": ["macbook"],
      "tags": ["rust", "dev"],
      "check": "which cargo-watch",
      "install": "cargo install cargo-watch",
      "dependsOn": ["rust"]
    },
    {
      "name": "starship",
      "profiles": ["macbook"],
      "tags": ["rust", "shell"],
      "check": "which starship",
      "install": "cargo install starship",
      "dependsOn": ["rust"]
    }
  ]
}
```

### npm Global Packages

```json
{
  "items": [
    {
      "name": "nodejs",
      "profiles": ["macbook"],
      "tags": ["runtime", "node"],
      "check": "which node",
      "install": "asdf install nodejs 22 && asdf global nodejs 22",
      "dependsOn": ["asdf", "nodejs-plugin"]
    },
    {
      "name": "pnpm",
      "profiles": ["macbook"],
      "tags": ["runtime", "node"],
      "check": "which pnpm",
      "install": "npm install -g pnpm",
      "dependsOn": ["nodejs"]
    },
    {
      "name": "typescript",
      "profiles": ["macbook"],
      "tags": ["runtime", "node"],
      "check": "which tsc",
      "install": "npm install -g typescript",
      "dependsOn": ["nodejs"]
    }
  ]
}
```

## Dotfiles Management

### From a Single Repository

Clone your entire dotfiles repo, then symlink or use stow:

```json
{
  "items": [
    {
      "name": "dotfiles",
      "profiles": ["macbook"],
      "tags": ["dotfiles", "git"],
      "check": "~/.dotfiles",
      "onCheck": "path-exists",
      "install": {
        "source": "git",
        "repo": "https://github.com/username/dotfiles.git",
        "path": "~/.dotfiles"
      }
    },
    {
      "name": "stow",
      "profiles": ["macbook"],
      "tags": ["brew", "dotfiles"],
      "check": "which stow",
      "install": "brew install stow",
      "group": "brew"
    },
    {
      "name": "dotfiles-link",
      "profiles": ["macbook"],
      "tags": ["dotfiles", "shell"],
      "check": "~/.zshrc",
      "onCheck": "path-exists",
      "install": "cd ~/.dotfiles && stow zsh nvim git",
      "dependsOn": ["dotfiles", "stow"],
      "backup": "~/.zshrc"
    }
  ]
}
```

### Sparse Checkout (Single Folder)

Clone only specific folders from a large repo:

```json
{
  "items": [
    {
      "name": "nvim-config",
      "profiles": ["macbook"],
      "tags": ["editor", "dotfiles"],
      "check": "~/.config/nvim",
      "onCheck": "path-exists",
      "install": {
        "source": "git",
        "repo": "https://github.com/username/dotfiles.git",
        "path": "~/.config/nvim",
        "sparse": ["nvim/.config/nvim"]
      },
      "backup": "~/.config/nvim"
    }
  ]
}
```

### Individual Config Files

For configs not in a repo:

```json
{
  "items": [
    {
      "name": "zshrc",
      "profiles": ["macbook"],
      "tags": ["dotfiles", "shell"],
      "check": "~/.zshrc",
      "onCheck": "path-exists",
      "install": "curl -o ~/.zshrc https://raw.githubusercontent.com/username/dotfiles/main/.zshrc",
      "backup": "~/.zshrc"
    },
    {
      "name": "gitconfig",
      "profiles": ["macbook"],
      "tags": ["dotfiles", "git"],
      "check": "~/.gitconfig",
      "onCheck": "path-exists",
      "install": "curl -o ~/.gitconfig https://raw.githubusercontent.com/username/dotfiles/main/.gitconfig",
      "backup": "~/.gitconfig"
    }
  ]
}
```

## Development Environment Setup

### Complete Node.js Setup

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
      "name": "asdf",
      "profiles": ["macbook"],
      "tags": ["runtime", "version-manager"],
      "check": "which asdf",
      "install": "brew install asdf",
      "group": "brew",
      "dependsOn": ["homebrew"]
    },
    {
      "name": "nodejs-plugin",
      "profiles": ["macbook"],
      "tags": ["runtime", "node"],
      "check": "asdf plugin list | grep -q nodejs",
      "install": "asdf plugin add nodejs",
      "dependsOn": ["asdf"]
    },
    {
      "name": "nodejs",
      "profiles": ["macbook"],
      "tags": ["runtime", "node"],
      "check": "node --version | grep -q 22",
      "install": "asdf install nodejs 22 && asdf global nodejs 22",
      "dependsOn": ["nodejs-plugin"]
    },
    {
      "name": "pnpm",
      "profiles": ["macbook"],
      "tags": ["runtime", "node"],
      "check": "which pnpm",
      "install": "npm install -g pnpm",
      "dependsOn": ["nodejs"]
    }
  ]
}
```

### Complete Python Setup

```json
{
  "items": [
    {
      "name": "pyenv",
      "profiles": ["macbook"],
      "tags": ["runtime", "python"],
      "check": "which pyenv",
      "install": "brew install pyenv",
      "group": "brew",
      "dependsOn": ["homebrew"]
    },
    {
      "name": "python-3.12",
      "profiles": ["macbook"],
      "tags": ["runtime", "python"],
      "check": "pyenv versions | grep -q 3.12",
      "install": "pyenv install 3.12 && pyenv global 3.12",
      "dependsOn": ["pyenv"]
    },
    {
      "name": "pipx",
      "profiles": ["macbook"],
      "tags": ["runtime", "python"],
      "check": "which pipx",
      "install": "brew install pipx",
      "group": "brew",
      "dependsOn": ["homebrew"]
    },
    {
      "name": "poetry",
      "profiles": ["macbook"],
      "tags": ["runtime", "python"],
      "check": "which poetry",
      "install": "pipx install poetry",
      "dependsOn": ["pipx"]
    }
  ]
}
```

### Complete Rust Setup

```json
{
  "items": [
    {
      "name": "rust",
      "profiles": ["macbook"],
      "tags": ["rust", "runtime"],
      "check": "which rustc",
      "install": "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable"
    },
    {
      "name": "rust-analyzer",
      "profiles": ["macbook"],
      "tags": ["rust", "editor"],
      "check": "which rust-analyzer",
      "install": "rustup component add rust-analyzer",
      "dependsOn": ["rust"]
    },
    {
      "name": "cargo-watch",
      "profiles": ["macbook"],
      "tags": ["rust", "dev"],
      "check": "which cargo-watch",
      "install": "cargo install cargo-watch",
      "dependsOn": ["rust"]
    },
    {
      "name": "cargo-edit",
      "profiles": ["macbook"],
      "tags": ["rust", "dev"],
      "check": "cargo install --list | grep -q cargo-edit",
      "install": "cargo install cargo-edit",
      "dependsOn": ["rust"]
    }
  ]
}
```

## Multi-Machine Configuration

### Work vs Personal

```json
{
  "items": [
    {
      "name": "neovim",
      "profiles": ["work", "personal"],
      "check": "which nvim",
      "install": "brew install neovim",
      "group": "brew",
      "tags": ["essential"]
    },
    {
      "name": "slack",
      "profiles": ["work"],
      "check": "/Applications/Slack.app",
      "onCheck": "path-exists",
      "install": "brew install --cask slack",
      "group": "brew",
      "tags": ["communication", "work"]
    },
    {
      "name": "work-vpn",
      "profiles": ["work"],
      "check": "/Applications/Company VPN.app",
      "onCheck": "path-exists",
      "install": "brew install --cask company-vpn",
      "group": "brew",
      "tags": ["networking", "work"]
    },
    {
      "name": "steam",
      "profiles": ["personal"],
      "check": "/Applications/Steam.app",
      "onCheck": "path-exists",
      "install": "brew install --cask steam",
      "group": "brew",
      "tags": ["gaming"]
    },
    {
      "name": "personal-repos",
      "profiles": ["personal"],
      "check": "~/Projects/personal",
      "onCheck": "path-exists",
      "install": "mkdir -p ~/Projects/personal",
      "tags": ["personal"]
    }
  ]
}
```

Usage:

```bash
# On work machine
rig --ci --profile work

# On personal machine
rig --ci --profile personal

# Just the essentials on any machine
rig --ci --profile work --tags essential
```

### Desktop vs Laptop

```json
{
  "items": [
    {
      "name": "obs",
      "profiles": ["desktop"],
      "tags": ["media", "desktop"],
      "check": "/Applications/OBS.app",
      "onCheck": "path-exists",
      "install": "brew install --cask obs",
      "group": "brew"
    },
    {
      "name": "battery-toolkit",
      "profiles": ["laptop"],
      "tags": ["power", "laptop"],
      "check": "/Applications/AlDente.app",
      "onCheck": "path-exists",
      "install": "brew install --cask aldente",
      "group": "brew"
    }
  ]
}
```

### Server-Only Services

Server services should live outside the workstation profile. Bind them to a server surface and use tags to select the service slice.

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
    }
  ]
}
```

```bash
rig --ci --profile server-home --tags server --dry-run
```

## Advanced Patterns

### Self-Updating Configuration

Store your config in a repo and pull updates:

```json
{
  "items": [
    {
      "name": "system-config-repo",
      "profiles": ["macbook"],
      "tags": ["config", "git"],
      "check": "~/.system-config",
      "onCheck": "path-exists",
      "install": {
        "source": "git",
        "repo": "https://github.com/username/system-config.git",
        "path": "~/.system-config"
      },
      "update": "cd ~/.system-config && git pull"
    }
  ]
}
```

Then run with:

```bash
rig -c ~/.system-config/system-config.json
```

### Checking Service Status

```json
{
  "items": [
    {
      "name": "docker",
      "profiles": ["macbook"],
      "tags": ["containers", "brew"],
      "check": "docker info > /dev/null 2>&1",
      "install": "brew install --cask docker",
      "group": "brew"
    },
    {
      "name": "postgres",
      "profiles": ["macbook"],
      "tags": ["database", "brew"],
      "check": "brew services list | grep postgresql | grep -q started",
      "install": "brew install postgresql@16 && brew services start postgresql@16",
      "group": "brew"
    }
  ]
}
```

### Complex Check Commands

```json
{
  "items": [
    {
      "name": "node-correct-version",
      "profiles": ["macbook"],
      "tags": ["runtime", "node"],
      "check": "node --version | grep -E '^v(20|22)\\.'",
      "install": "asdf install nodejs 22 && asdf global nodejs 22"
    },
    {
      "name": "pnpm-latest",
      "profiles": ["macbook"],
      "tags": ["runtime", "node"],
      "check": "pnpm --version | awk -F. '{exit ($1 >= 9) ? 0 : 1}'",
      "install": "npm install -g pnpm@latest"
    }
  ]
}
```

### Running Scripts After Install

```json
{
  "items": [
    {
      "name": "nvim-plugins",
      "profiles": ["macbook"],
      "tags": ["editor", "plugins"],
      "check": "~/.local/share/nvim/lazy",
      "onCheck": "path-exists",
      "install": "nvim --headless '+Lazy! sync' +qa",
      "dependsOn": ["neovim", "nvim-config"]
    },
    {
      "name": "tmux-plugins",
      "profiles": ["macbook"],
      "tags": ["terminal", "plugins"],
      "check": "~/.tmux/plugins/tpm",
      "onCheck": "path-exists",
      "install": "git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm && ~/.tmux/plugins/tpm/scripts/install_plugins.sh",
      "dependsOn": ["tmux", "tmux-config"]
    }
  ]
}
```

## Troubleshooting

### Debug Mode

Use `--dry-run` to see what would happen without making changes:

```bash
rig --ci --profile macbook --dry-run
```

### Check Individual Items

Test a specific item:

```bash
rig --ci --profile macbook --only neovim --dry-run
```

### Common Issues

**"Command not found" after install**

The shell may need to reload. Either:

- Start a new shell session
- Source your shell config: `source ~/.zshrc`
- Use absolute paths in subsequent items

**Homebrew concurrent access error**

Prefer the native brew source (`"install": { "source": "brew", ... }`) because it automatically serializes brew installs.

If you use string install commands, ensure all brew items have `"group": "brew"`:

```json
{
  "name": "neovim",
  "profiles": ["macbook"],
  "tags": ["brew", "editor"],
  "check": "which nvim",
  "install": "brew install neovim",
  "group": "brew"
}
```

**Path expansion not working**

Paths like `~/.config` are expanded automatically. If you have issues:

```json
{
  "check": "$HOME/.config/nvim",
  "onCheck": "path-exists"
}
```

**Dependencies not found**

Check that `dependsOn` references valid item names:

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
  "dependsOn": ["neovim"]
}
```

### Getting Help

```bash
rig --help
```

Check the [README](./README.md) for CLI options and [ARCHITECTURE.md](./ARCHITECTURE.md) for design details.
