#!/usr/bin/env bun

import { mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { compile, type Target } from "./compile";

const distDir = "dist";
const version: string = JSON.parse(readFileSync("package.json", "utf8")).version;

const targets: readonly Target[] = [
  { platform: "darwin", arch: "x64" },
  { platform: "darwin", arch: "arm64" },
  { platform: "linux", arch: "x64" },
  { platform: "linux", arch: "arm64" },
];

console.log("Cleaning dist directory...");
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

console.log(`\nBuilding rig v${version}...\n`);

for (const target of targets) {
  const outfile = join(distDir, `rig-${target.platform}-${target.arch}`);
  console.log(`Building ${target.platform}-${target.arch}...`);
  try {
    await compile(target, outfile);
    const { stdout } = await Bun.$`du -h ${outfile}`.quiet();
    console.log(`  ${outfile} (${stdout.toString().split("\t")[0]})`);
  } catch (error) {
    console.error(`  Error building ${target.platform}-${target.arch}:`, error);
  }
}

console.log(`
Build complete!

Binaries available at: ${distDir}/

To install locally (compiles for your host directly — does not require this build step):
  bun run install:local

To test:
  ./${distDir}/rig-darwin-arm64 --help
`);
