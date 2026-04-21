import { readFileSync } from "fs";

export type Target = {
  platform: "darwin" | "linux";
  arch: "x64" | "arm64";
};

const version: string = JSON.parse(readFileSync("package.json", "utf8")).version;

export async function compile(target: Target, outfile: string): Promise<void> {
  const result = await Bun.build({
    target: "bun",
    compile: {
      target: `bun-${target.platform}-${target.arch}`,
      outfile,
    },
    entrypoints: ["src/index.ts"],
    define: {
      APP_VERSION: `'${version}'`,
    },
    minify: true,
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`Failed to build ${target.platform}-${target.arch}`);
  }

  await Bun.$`chmod +x ${outfile}`;

  if (target.platform === "darwin" && process.platform === "darwin") {
    // Bun's compiled macOS binaries embed a stale code-signature blob that
    // codesign refuses to overwrite ("invalid or unsupported format for
    // signature") and Gatekeeper kills at launch. Strip, then re-sign ad-hoc.
    await Bun.$`codesign --remove-signature ${outfile}`.nothrow().quiet();
    await Bun.$`codesign --sign - --force ${outfile}`.quiet();
  }
}
