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
    const options = await parseCli(["bun", "rig"]);

    expect(options.config).toBe(defaultConfigSource);
    expect(options.ci).toBe(false);
    expect(options.init).toBe(false);
    expect(options.apply).toBe(false);
  });

  it("parses --init as the starter-config entry point", async () => {
    const options = await parseCli(["bun", "rig", "--init"]);

    expect(options.init).toBe(true);
    expect(options.config).toBe(defaultConfigSource);
  });

  it("parses --init with a custom local target path", async () => {
    const options = await parseCli(["bun", "rig", "--init", "./work-config.json"]);

    expect(options.init).toBe(true);
    expect(options.config).toBe("./work-config.json");
  });

  it("accepts an HTTPS config source as the main invocation path", async () => {
    const options = await parseCli(["bun", "rig", "https://example.com/system-config.json"]);

    expect(options.config).toBe("https://example.com/system-config.json");
    expect(options.apply).toBe(false);
  });

  it("accepts GitHub shorthand as the main invocation path", async () => {
    const options = await parseCli(["bun", "rig", "gh:guilhermecastro/rig"]);

    expect(options.config).toBe("gh:guilhermecastro/rig");
    expect(options.apply).toBe(false);
  });

  it("preserves the --config option for explicit local file paths", async () => {
    const options = await parseCli(["bun", "rig", "--config", "./custom-config.json"]);

    expect(options.config).toBe("./custom-config.json");
  });

  it("parses --apply for explicit remote execution", async () => {
    const options = await parseCli([
      "bun",
      "rig",
      "--apply",
      "https://example.com/system-config.json",
    ]);

    expect(options.config).toBe("https://example.com/system-config.json");
    expect(options.apply).toBe(true);
  });

  it("parses --apply for GitHub shorthand execution", async () => {
    const options = await parseCli(["bun", "rig", "--apply", "gh:guilhermecastro/rig"]);

    expect(options.config).toBe("gh:guilhermecastro/rig");
    expect(options.apply).toBe(true);
  });

  it("preserves pinned and integrity-annotated remote sources verbatim", async () => {
    const configSource =
      "gh:guilhermecastro/rig@0123456789abcdef0123456789abcdef01234567#sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    const options = await parseCli(["bun", "rig", "--apply", configSource]);

    expect(options.config).toBe(configSource);
    expect(options.apply).toBe(true);
  });

  it("parses --status as a read-only inspection flag", async () => {
    const options = await parseCli(["bun", "rig", "--status"]);

    expect(options.status).toBe(true);
    expect(options.why).toBeUndefined();
  });

  it("parses --why with the requested item name", async () => {
    const options = await parseCli(["bun", "rig", "--why", "neovim"]);

    expect(options.status).toBe(false);
    expect(options.why).toBe("neovim");
  });

  it("parses --ci with the selected profile for headless execution", async () => {
    const options = await parseCli(["bun", "rig", "--ci", "--profile", "macbook"]);

    expect(options.ci).toBe(true);
    expect(options.profile).toBe("macbook");
  });
});
