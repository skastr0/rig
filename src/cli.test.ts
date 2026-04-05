import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { BunContext } from "@effect/platform-bun";
import { runCli, type CliOptions } from "./cli.js";
import { defaultConfigSource } from "./configSource.js";

const parseCli = async (argv: readonly string[]): Promise<CliOptions> => {
  let parsedOptions: CliOptions | undefined;

  await Effect.runPromise(
    runCli((options) =>
      Effect.sync(() => {
        parsedOptions = options;
      }),
    )(argv).pipe(Effect.provide(BunContext.layer)),
  );

  expect(parsedOptions).toBeDefined();

  return parsedOptions!;
};

describe("runCli", () => {
  it("defaults to the local system-config.json path", async () => {
    const options = await parseCli(["bun", "system-setup"]);

    expect(options.config).toBe(defaultConfigSource);
    expect(options.apply).toBe(false);
  });

  it("accepts an HTTPS config source as the main invocation path", async () => {
    const options = await parseCli([
      "bun",
      "system-setup",
      "https://example.com/system-config.json",
    ]);

    expect(options.config).toBe("https://example.com/system-config.json");
    expect(options.apply).toBe(false);
  });

  it("accepts GitHub shorthand as the main invocation path", async () => {
    const options = await parseCli(["bun", "system-setup", "gh:guilhermecastro/system-setup"]);

    expect(options.config).toBe("gh:guilhermecastro/system-setup");
    expect(options.apply).toBe(false);
  });

  it("preserves the --config option for explicit local file paths", async () => {
    const options = await parseCli(["bun", "system-setup", "--config", "./custom-config.json"]);

    expect(options.config).toBe("./custom-config.json");
  });

  it("parses --apply for explicit remote execution", async () => {
    const options = await parseCli([
      "bun",
      "system-setup",
      "--apply",
      "https://example.com/system-config.json",
    ]);

    expect(options.config).toBe("https://example.com/system-config.json");
    expect(options.apply).toBe(true);
  });

  it("parses --apply for GitHub shorthand execution", async () => {
    const options = await parseCli([
      "bun",
      "system-setup",
      "--apply",
      "gh:guilhermecastro/system-setup",
    ]);

    expect(options.config).toBe("gh:guilhermecastro/system-setup");
    expect(options.apply).toBe(true);
  });

  it("preserves pinned and integrity-annotated remote sources verbatim", async () => {
    const configSource =
      "gh:guilhermecastro/system-setup@0123456789abcdef0123456789abcdef01234567#sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    const options = await parseCli(["bun", "system-setup", "--apply", configSource]);

    expect(options.config).toBe(configSource);
    expect(options.apply).toBe(true);
  });
});
