import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type PlatformPackage = {
  readonly directory: string;
  readonly name: string;
  readonly platform: "darwin" | "linux";
  readonly arch: "arm64" | "x64";
};

export type PackageJson = {
  readonly name: string;
  readonly version: string;
  readonly optionalDependencies?: Record<string, string>;
};

export const rootPackage = {
  directory: ".",
  name: "@skastr0/rig",
} as const;

export const platformPackages: readonly PlatformPackage[] = [
  {
    directory: "packages/rig-darwin-arm64",
    name: "@skastr0/rig-darwin-arm64",
    platform: "darwin",
    arch: "arm64",
  },
  {
    directory: "packages/rig-darwin-x64",
    name: "@skastr0/rig-darwin-x64",
    platform: "darwin",
    arch: "x64",
  },
  {
    directory: "packages/rig-linux-arm64",
    name: "@skastr0/rig-linux-arm64",
    platform: "linux",
    arch: "arm64",
  },
  {
    directory: "packages/rig-linux-x64",
    name: "@skastr0/rig-linux-x64",
    platform: "linux",
    arch: "x64",
  },
] as const;

export const publishPackageDirectories = [
  ...platformPackages.map((packageInfo) => packageInfo.directory),
  rootPackage.directory,
] as const;

export const platformKey = (platformPackage: PlatformPackage): string =>
  `${platformPackage.platform}-${platformPackage.arch}`;

export const platformBinaryPath = (platformPackage: PlatformPackage): string =>
  join(platformPackage.directory, "bin", "rig");

export function packageJsonPath(directory: string): string {
  return directory === "." ? "package.json" : join(directory, "package.json");
}

export function readPackageJson(directory: string): PackageJson {
  return JSON.parse(readFileSync(packageJsonPath(directory), "utf8")) as PackageJson;
}

export function assertNpmPackageMetadata(): string {
  const root = readPackageJson(rootPackage.directory);

  if (root.name !== rootPackage.name) {
    throw new Error(`Expected root package name ${rootPackage.name}; found ${root.name}`);
  }

  for (const platformPackage of platformPackages) {
    const packageJson = readPackageJson(platformPackage.directory);

    if (packageJson.name !== platformPackage.name) {
      throw new Error(
        `Expected ${platformPackage.directory} package name ${platformPackage.name}; found ${packageJson.name}`,
      );
    }

    if (packageJson.version !== root.version) {
      throw new Error(
        `${platformPackage.name} version ${packageJson.version} does not match ${root.name} ${root.version}`,
      );
    }

    const optionalVersion = root.optionalDependencies?.[platformPackage.name];
    if (optionalVersion !== root.version) {
      throw new Error(
        `${root.name} optional dependency ${platformPackage.name} must be ${root.version}; found ${optionalVersion ?? "missing"}`,
      );
    }
  }

  return root.version;
}

export function assertPlatformBinariesBuilt(): void {
  for (const platformPackage of platformPackages) {
    const binaryPath = platformBinaryPath(platformPackage);
    if (!existsSync(binaryPath)) {
      throw new Error(`Missing built binary: ${binaryPath}. Run bun run build first.`);
    }

    const mode = statSync(binaryPath).mode;
    if ((mode & 0o111) === 0) {
      throw new Error(`Built binary is not executable: ${binaryPath}`);
    }
  }
}
