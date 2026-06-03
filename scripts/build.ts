#!/usr/bin/env bun

import { copyFileSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { compile, type Target } from "./compile";
import { platformBinaryPath, platformKey, platformPackages } from "./npmPackages";

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

const failedTargets: string[] = [];
const packageByTarget = new Map(
  platformPackages.map((platformPackage) => [platformKey(platformPackage), platformPackage]),
);

for (const target of targets) {
  const outfile = join(distDir, `rig-${target.platform}-${target.arch}`);
  const targetLabel = `${target.platform}-${target.arch}`;

  console.log("Building %s-%s...", target.platform, target.arch);
  try {
    await compile(target, outfile);
    const { stdout } = await Bun.$`du -h ${outfile}`.quiet();
    console.log(`  ${outfile} (${stdout.toString().split("\t")[0]})`);

    const platformPackage = packageByTarget.get(targetLabel);
    if (platformPackage !== undefined) {
      const packageBinaryPath = platformBinaryPath(platformPackage);
      mkdirSync(join(platformPackage.directory, "bin"), { recursive: true });
      copyFileSync(outfile, packageBinaryPath);
      await Bun.$`chmod +x ${packageBinaryPath}`;
    }
  } catch (error) {
    failedTargets.push(targetLabel);
    console.error("  Error building %s:", targetLabel, error);
  }
}

if (failedTargets.length > 0) {
  console.error(`
Build failed for: ${failedTargets.join(", ")}

If OpenTUI native packages are missing for cross-target builds, run:
  bun install --cpu='*' --os='*'
`);
  process.exit(1);
}

console.log(`
Build complete!

Binaries available at: ${distDir}/

To install locally (compiles for your host directly — does not require this build step):
  bun run install:local

To test:
  ./${distDir}/rig-darwin-arm64 --help
`);
