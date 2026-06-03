#!/usr/bin/env bun

import {
  assertNpmPackageMetadata,
  assertPlatformBinariesBuilt,
  publishPackageDirectories,
} from "./npmPackages";

const version = assertNpmPackageMetadata();
assertPlatformBinariesBuilt();

console.log(`Inspecting npm packages for rig v${version}...`);

for (const packageDirectory of publishPackageDirectories) {
  const packagePath = packageDirectory === "." ? "." : `./${packageDirectory}`;
  console.log(`\n--- npm pack --dry-run ${packagePath} ---`);
  await Bun.$`npm pack --dry-run ${packagePath}`;
}
