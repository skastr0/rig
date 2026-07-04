#!/usr/bin/env bun

import { existsSync, mkdirSync, rmSync, symlinkSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { compile } from "./compile";
import { detectHostTarget } from "./hostTarget";

const INSTALL_DIR = process.env.INSTALL_DIR || join(homedir(), ".local", "bin");
const DEV_BINARY_NAME = process.env.RIG_DEV_BIN || "rig-dev";
const PRODUCTION_BINARY_NAME = "rig";
const DEV_BUILD_DIR = process.env.RIG_DEV_BUILD_DIR || join(".rig-dev", "bin");

const target = detectHostTarget();
const targetLabel = `${target.platform}-${target.arch}`;
const devPath = join(INSTALL_DIR, DEV_BINARY_NAME);
const productionPath = join(INSTALL_DIR, PRODUCTION_BINARY_NAME);
const binaryPath = join(DEV_BUILD_DIR, `${DEV_BINARY_NAME}-${targetLabel}`);

console.log(`Building ${DEV_BINARY_NAME} for ${targetLabel}...`);
mkdirSync(INSTALL_DIR, { recursive: true });
mkdirSync(DEV_BUILD_DIR, { recursive: true });

if (existsSync(productionPath)) {
  console.log(`Leaving production binary untouched: ${productionPath}`);
}

rmSync(devPath, { force: true });

await compile(target, binaryPath, { binaryName: DEV_BINARY_NAME });
symlinkSync(resolve(binaryPath), devPath);

console.log(`Installed ${DEV_BINARY_NAME} to ${devPath}`);

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

console.log(`\nRun '${DEV_BINARY_NAME} --help' to try the dev build.`);
console.log(`Run 'bun run install:local' only when you want to replace ${PRODUCTION_BINARY_NAME}.`);
