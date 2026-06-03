#!/usr/bin/env bun

import {
  assertNpmPackageMetadata,
  assertPlatformBinariesBuilt,
  publishPackageDirectories,
  readPackageJson,
} from "./npmPackages";

const version = assertNpmPackageMetadata();
assertPlatformBinariesBuilt();

console.log(`Publishing npm packages for rig v${version}...`);

for (const packageDirectory of publishPackageDirectories) {
  const packageJson = readPackageJson(packageDirectory);
  const packagePath = packageDirectory === "." ? "." : `./${packageDirectory}`;
  const packageSpec = `${packageJson.name}@${packageJson.version}`;

  const viewResult = await Bun.$`npm view ${packageSpec} version --prefer-online`.quiet().nothrow();
  if (viewResult.exitCode === 0) {
    console.log(`Skipping ${packageSpec}; already published.`);
    continue;
  }

  console.log(`Publishing ${packageSpec} from ${packagePath}...`);
  await Bun.$`npm publish ${packagePath} --access public`;
}
