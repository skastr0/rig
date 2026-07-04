#!/usr/bin/env bun

import { mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { compile } from "./compile";
import { detectHostTarget } from "./hostTarget";

const INSTALL_DIR = process.env.INSTALL_DIR || join(homedir(), ".local", "bin");
const BINARY_NAME = "rig";

const target = detectHostTarget();
const destPath = join(INSTALL_DIR, BINARY_NAME);

console.log(`Building rig for ${target.platform}-${target.arch}...`);
mkdirSync(INSTALL_DIR, { recursive: true });
await compile(target, destPath);

console.log(`Installed ${BINARY_NAME} to ${destPath}`);

const pathDirs = (process.env.PATH || "").split(":");
if (!pathDirs.includes(INSTALL_DIR)) {
  console.log(`
Note: ${INSTALL_DIR} is not in your PATH.
Add it to your shell configuration:

  # bash (~/.bashrc or ~/.bash_profile)
  export PATH="$HOME/.local/bin:$PATH"

  # zsh (~/.zshrc)
  export PATH="$HOME/.local/bin:$PATH"

  # fish (~/.config/fish/config.fish)
  set -gx PATH $HOME/.local/bin $PATH
`);
}

console.log(`\nRun '${BINARY_NAME} --help' to get started.`);
