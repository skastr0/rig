#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

const platformPackages = {
  "darwin-arm64": "@skastr0/rig-darwin-arm64",
  "darwin-x64": "@skastr0/rig-darwin-x64",
  "linux-arm64": "@skastr0/rig-linux-arm64",
  "linux-x64": "@skastr0/rig-linux-x64",
};

const platformKey = `${process.platform}-${process.arch}`;
const packageName = platformPackages[platformKey];

if (packageName === undefined) {
  console.error(`rig does not provide a prebuilt binary for ${platformKey}.`);
  console.error("Supported targets: darwin-arm64, darwin-x64, linux-arm64, linux-x64.");
  process.exit(1);
}

let binaryPath;
try {
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  binaryPath = join(dirname(packageJsonPath), "bin", "rig");
} catch {
  console.error(`The optional package ${packageName} was not installed.`);
  console.error("Reinstall @skastr0/rig with optional dependencies enabled.");
  process.exit(1);
}

const child = spawn(binaryPath, process.argv.slice(2), { stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on("error", (error) => {
  console.error(`Failed to execute rig binary at ${binaryPath}: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
