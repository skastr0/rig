#!/usr/bin/env bun

import { mkdirSync } from "fs";
import { join } from "path";
import { homedir, platform, arch } from "os";
import { compile, type Target } from "./compile";

const INSTALL_DIR = process.env.INSTALL_DIR || join(homedir(), ".local", "bin");
const BINARY_NAME = "rig";

function detectTarget(): Target {
  const os = platform();
  const cpu = arch();

  let platformStr: Target["platform"];
  switch (os) {
    case "darwin":
      platformStr = "darwin";
      break;
    case "linux":
      platformStr = "linux";
      break;
    default:
      console.error(`Unsupported operating system: ${os}`);
      process.exit(1);
  }

  let archStr: Target["arch"];
  switch (cpu) {
    case "x64":
      archStr = "x64";
      break;
    case "arm64":
      archStr = "arm64";
      break;
    default:
      console.error(`Unsupported architecture: ${cpu}`);
      process.exit(1);
  }

  return { platform: platformStr, arch: archStr };
}

const target = detectTarget();
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
