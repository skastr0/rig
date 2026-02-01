# system-setup Usage Guide

This guide covers common patterns and real-world examples for configuring your system with `system-setup`.

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
      "check": "which nvim",
      "install": "brew install neovim",
      "group": "brew"
    }
  ]
}
```

Run:

```bash
# See what would be installed
system-setup --dry-run

# Actually install
system-setup
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
    { "name": "ripgrep", "check": "which rg", "install": "brew install ripgrep", "group": "brew" },
    { "name": "fd", "check": "which fd", "install": "brew install fd", "group": "brew" },
    { "name": "bat", "check": "which bat", "install": "brew install bat", "group": "brew" },
    { "name": "eza", "check": "which eza", "install": "brew install eza", "group": "brew" },
    { "name": "zoxide", "check": "which zoxide", "install": "brew install zoxide", "group": "brew" }
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
      "check": "which nvim",
      "install": "brew install neovim",
      "group": "brew"
    },
    {
      "name": "nvim-config",
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
      "check": "which asdf",
      "install": "brew install asdf",
      "group": "brew"
    },
    {
      "name": "nodejs-plugin",
      "check": "asdf plugin list | grep -q nodejs",
      "install": "asdf plugin add nodejs",
      "dependsOn": ["asdf"]
    },
    {
      "name": "nodejs-22",
      "check": "asdf list nodejs | grep -q 22",
      "install": "asdf install nodejs 22 && asdf global nodejs 22",
      "dependsOn": ["nodejs-plugin"]
    }
  ]
}
```

### Pattern 4: Conditional Installation

Use tags to organize optional components:

```json
{
  "items": [
    { "name": "neovim", "check": "which nvim", "install": "...", "tags": ["editor", "essential"] },
    { "name": "emacs", "check": "which emacs", "install": "...", "tags": ["editor"] },
    { "name": "vscode", "check": "which code", "install": "...", "tags": ["editor", "gui"] },
    { "name": "docker", "check": "which docker", "install": "...", "tags": ["devops"] },
    { "name": "kubectl", "check": "which kubectl", "install": "...", "tags": ["devops", "k8s"] }
  ]
}
```

```bash
system-setup --tags essential      # Only essential items
system-setup --tags editor         # All editors
system-setup --tags devops         # DevOps tools
```

## Package Manager Examples

### Homebrew (macOS)

```json
{
  "items": [
    {
      "name": "homebrew",
      "check": "which brew",
      "install": "/bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
    },
    {
      "name": "neovim",
      "check": "which nvim",
      "install": "brew install neovim",
      "update": "brew upgrade neovim",
      "group": "brew",
      "dependsOn": ["homebrew"]
    },
    {
      "name": "firefox",
      "check": "/Applications/Firefox.app",
      "onCheck": "path-exists",
      "install": "brew install --cask firefox",
      "group": "brew",
      "dependsOn": ["homebrew"]
    }
  ]
}
```

**Important**: Always use `"group": "brew"` for Homebrew items - brew uses a lock file and can't run concurrently.

### APT (Debian/Ubuntu)

```json
{
  "items": [
    {
      "name": "build-essential",
      "check": "dpkg -l build-essential | grep -q ^ii",
      "install": "sudo apt-get update && sudo apt-get install -y build-essential",
      "group": "apt"
    },
    {
      "name": "neovim",
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
      "check": "which rustc",
      "install": "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"
    },
    {
      "name": "cargo-watch",
      "check": "which cargo-watch",
      "install": "cargo install cargo-watch",
      "dependsOn": ["rust"]
    },
    {
      "name": "starship",
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
      "check": "which node",
      "install": "asdf install nodejs 22 && asdf global nodejs 22",
      "dependsOn": ["asdf", "nodejs-plugin"]
    },
    {
      "name": "pnpm",
      "check": "which pnpm",
      "install": "npm install -g pnpm",
      "dependsOn": ["nodejs"]
    },
    {
      "name": "typescript",
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
      "check": "which stow",
      "install": "brew install stow",
      "group": "brew"
    },
    {
      "name": "dotfiles-link",
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
      "check": "~/.zshrc",
      "onCheck": "path-exists",
      "install": "curl -o ~/.zshrc https://raw.githubusercontent.com/username/dotfiles/main/.zshrc",
      "backup": "~/.zshrc"
    },
    {
      "name": "gitconfig",
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
      "check": "which brew",
      "install": "/bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
    },
    {
      "name": "asdf",
      "check": "which asdf",
      "install": "brew install asdf",
      "group": "brew",
      "dependsOn": ["homebrew"]
    },
    {
      "name": "nodejs-plugin",
      "check": "asdf plugin list | grep -q nodejs",
      "install": "asdf plugin add nodejs",
      "dependsOn": ["asdf"]
    },
    {
      "name": "nodejs",
      "check": "node --version | grep -q 22",
      "install": "asdf install nodejs 22 && asdf global nodejs 22",
      "dependsOn": ["nodejs-plugin"]
    },
    {
      "name": "pnpm",
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
      "check": "which pyenv",
      "install": "brew install pyenv",
      "group": "brew",
      "dependsOn": ["homebrew"]
    },
    {
      "name": "python-3.12",
      "check": "pyenv versions | grep -q 3.12",
      "install": "pyenv install 3.12 && pyenv global 3.12",
      "dependsOn": ["pyenv"]
    },
    {
      "name": "pipx",
      "check": "which pipx",
      "install": "brew install pipx",
      "group": "brew",
      "dependsOn": ["homebrew"]
    },
    {
      "name": "poetry",
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
      "check": "which rustc",
      "install": "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable"
    },
    {
      "name": "rust-analyzer",
      "check": "which rust-analyzer",
      "install": "rustup component add rust-analyzer",
      "dependsOn": ["rust"]
    },
    {
      "name": "cargo-watch",
      "check": "which cargo-watch",
      "install": "cargo install cargo-watch",
      "dependsOn": ["rust"]
    },
    {
      "name": "cargo-edit",
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
  "profiles": {
    "work": {
      "exclude": ["gaming", "personal-repos", "entertainment"],
      "items": [
        {
          "name": "slack",
          "check": "/Applications/Slack.app",
          "onCheck": "path-exists",
          "install": "brew install --cask slack",
          "group": "brew"
        },
        {
          "name": "zoom",
          "check": "/Applications/zoom.us.app",
          "onCheck": "path-exists",
          "install": "brew install --cask zoom",
          "group": "brew"
        },
        {
          "name": "work-vpn",
          "check": "/Applications/Company VPN.app",
          "onCheck": "path-exists",
          "install": "brew install --cask company-vpn",
          "group": "brew"
        }
      ]
    },
    "personal": {
      "exclude": ["work-vpn", "work-tools"],
      "items": [
        {
          "name": "steam",
          "check": "/Applications/Steam.app",
          "onCheck": "path-exists",
          "install": "brew install --cask steam",
          "group": "brew",
          "tags": ["gaming"]
        }
      ]
    }
  },
  "items": [
    {
      "name": "neovim",
      "check": "which nvim",
      "install": "brew install neovim",
      "group": "brew",
      "tags": ["essential"]
    },
    {
      "name": "personal-repos",
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
system-setup --profile work

# On personal machine
system-setup --profile personal

# Just the essentials on any machine
system-setup --tags essential
```

### Desktop vs Laptop

```json
{
  "profiles": {
    "desktop": {
      "items": [
        {
          "name": "obs",
          "check": "/Applications/OBS.app",
          "onCheck": "path-exists",
          "install": "brew install --cask obs",
          "group": "brew"
        }
      ]
    },
    "laptop": {
      "items": [
        {
          "name": "battery-toolkit",
          "check": "/Applications/AlDente.app",
          "onCheck": "path-exists",
          "install": "brew install --cask aldente",
          "group": "brew"
        }
      ]
    }
  },
  "items": []
}
```

## Advanced Patterns

### Self-Updating Configuration

Store your config in a repo and pull updates:

```json
{
  "items": [
    {
      "name": "system-config-repo",
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
system-setup -c ~/.system-config/system-config.json
```

### Checking Service Status

```json
{
  "items": [
    {
      "name": "docker",
      "check": "docker info > /dev/null 2>&1",
      "install": "brew install --cask docker",
      "group": "brew"
    },
    {
      "name": "postgres",
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
      "check": "node --version | grep -E '^v(20|22)\\.'",
      "install": "asdf install nodejs 22 && asdf global nodejs 22"
    },
    {
      "name": "pnpm-latest",
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
      "check": "~/.local/share/nvim/lazy",
      "onCheck": "path-exists",
      "install": "nvim --headless '+Lazy! sync' +qa",
      "dependsOn": ["neovim", "nvim-config"]
    },
    {
      "name": "tmux-plugins",
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
system-setup --dry-run
```

### Check Individual Items

Test a specific item:

```bash
system-setup --only neovim --dry-run
```

### Common Issues

**"Command not found" after install**

The shell may need to reload. Either:
- Start a new shell session
- Source your shell config: `source ~/.zshrc`
- Use absolute paths in subsequent items

**Homebrew concurrent access error**

Ensure all brew items have `"group": "brew"`:

```json
{ "name": "neovim", "install": "brew install neovim", "group": "brew" }
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
  "dependsOn": ["neovim"]  // Must match exact "name" of another item
}
```

### Getting Help

```bash
system-setup --help
```

Check the [README](./README.md) for CLI options and [ARCHITECTURE.md](./ARCHITECTURE.md) for design details.
