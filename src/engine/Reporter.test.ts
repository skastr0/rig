import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect } from "effect";
import { resolveConfigSource } from "../configSource.js";
import { createReporter } from "./Reporter.js";
import { topologicalSort } from "./Planner.js";
import type { ExecutionResult, InspectionResult } from "./Executor.js";
import type { SystemItem } from "../schema/config.js";

const pinnedCommit = "0123456789abcdef0123456789abcdef01234567";
const integrityDigest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const makeItem = (name: string, dependsOn?: string[]): SystemItem => ({
  name,
  check: `which ${name}`,
  install: `brew install ${name}`,
  dependsOn,
});

describe("Reporter", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let output: string[];

  beforeEach(() => {
    output = [];
    consoleSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      output.push(args.join(" "));
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("printConfigSource", () => {
    it("should print the resolved remote config source", () => {
      const reporter = createReporter({ noColor: true });

      reporter.printConfigSource({
        _tag: "https",
        url: "https://example.com/system-config.json",
      });

      expect(output.some((line) => line.includes("Config Source"))).toBe(true);
      expect(
        output.some((line) => line.includes("remote HTTPS https://example.com/system-config.json")),
      ).toBe(true);
    });

    it("should show the canonical raw GitHub URL for shorthand sources", async () => {
      const reporter = createReporter({ noColor: true });
      const source = await Effect.runPromise(
        resolveConfigSource("gh:guilhermecastro/system-setup/configs/work.json"),
      );

      reporter.printConfigSource(source);

      expect(
        output.some((line) =>
          line.includes(
            "remote HTTPS https://raw.githubusercontent.com/guilhermecastro/system-setup/HEAD/configs/work.json",
          ),
        ),
      ).toBe(true);
    });

    it("should explain that remote configs preview by default", () => {
      const reporter = createReporter({ noColor: true });

      reporter.printConfigSource(
        {
          _tag: "https",
          url: "https://example.com/system-config.json",
        },
        {
          _tag: "remote_preview",
          dryRun: true,
          applyRequested: false,
        },
      );

      expect(output.some((line) => line.includes("Remote trust: preview only"))).toBe(true);
      expect(output.some((line) => line.includes("Re-run with --apply"))).toBe(true);
    });

    it("should print pinning and integrity metadata for audited remote configs", () => {
      const reporter = createReporter({ noColor: true });

      reporter.printConfigSource({
        _tag: "https",
        url: `https://raw.githubusercontent.com/guilhermecastro/system-setup/${pinnedCommit}/system-config.json`,
        pin: {
          provider: "github",
          ref: pinnedCommit,
        },
        integrity: {
          algorithm: "sha256",
          expected: integrityDigest,
        },
      });

      expect(
        output.some((line) => line.includes(`Remote pin: GitHub commit ${pinnedCommit}`)),
      ).toBe(true);
      expect(
        output.some((line) => line.includes(`Remote integrity: sha256:${integrityDigest}`)),
      ).toBe(true);
    });
  });

  describe("printPlan", () => {
    it("should print execution plan with levels", async () => {
      const reporter = createReporter({ noColor: true });
      const items = [makeItem("c", ["a", "b"]), makeItem("a"), makeItem("b")];
      const plan = await Effect.runPromise(topologicalSort(items));

      reporter.printPlan(plan);

      expect(output.some((line) => line.includes("Execution Plan"))).toBe(true);
      expect(output.some((line) => line.includes("Level 1"))).toBe(true);
      expect(output.some((line) => line.includes("Total: 3 items"))).toBe(true);
    });

    it("should indicate dry run mode", async () => {
      const reporter = createReporter({ noColor: true });
      const items = [makeItem("a")];
      const plan = await Effect.runPromise(topologicalSort(items));

      reporter.printPlan(plan, true);

      expect(output.some((line) => line.includes("Dry Run"))).toBe(true);
    });
  });

  describe("printProgress", () => {
    it("should print installed status", () => {
      const reporter = createReporter({ noColor: true });

      reporter.printProgress({
        name: "test",
        status: "installed",
        action: "installed",
      });

      expect(output.some((line) => line.includes("test") && line.includes("installed"))).toBe(true);
    });

    it("should print skipped for already installed", () => {
      const reporter = createReporter({ noColor: true });

      reporter.printProgress({
        name: "test",
        status: "installed",
        action: "skipped",
      });

      expect(output.some((line) => line.includes("already installed"))).toBe(true);
    });

    it("should print would install for dry run", () => {
      const reporter = createReporter({ noColor: true });

      reporter.printProgress({
        name: "test",
        status: "missing",
        action: "skipped",
      });

      expect(output.some((line) => line.includes("would install"))).toBe(true);
    });

    it("should include detail text when provided", () => {
      const reporter = createReporter({ noColor: true });

      reporter.printProgress({
        name: "projects-root",
        status: "missing",
        action: "skipped",
        detail: "create directory /Users/test/Projects",
      });

      expect(output.some((line) => line.includes("create directory /Users/test/Projects"))).toBe(
        true,
      );
    });

    it("should print updated status", () => {
      const reporter = createReporter({ noColor: true });

      reporter.printProgress({
        name: "test",
        status: "installed",
        action: "updated",
      });

      expect(output.some((line) => line.includes("test") && line.includes("updated"))).toBe(true);
    });

    it("should print would update for dry run with update", () => {
      const reporter = createReporter({ noColor: true });

      reporter.printProgress({
        name: "test",
        status: "installed",
        action: "would_update",
      });

      expect(output.some((line) => line.includes("would update"))).toBe(true);
    });

    it("should indicate backup was made", () => {
      const reporter = createReporter({ noColor: true });

      reporter.printProgress({
        name: "test",
        status: "installed",
        action: "installed",
        backed_up: "/backup/test",
      });

      expect(output.some((line) => line.includes("backed up"))).toBe(true);
    });

    it("should print failure reason", () => {
      const reporter = createReporter({ noColor: true });

      reporter.printProgress({
        name: "test",
        status: "error",
        action: "failed",
        error: 'Command "claude update" failed with exit code 1: network unavailable',
      });

      expect(output.some((line) => line.includes("failed"))).toBe(true);
      expect(output.some((line) => line.includes("Reason:"))).toBe(true);
      expect(output.some((line) => line.includes("network unavailable"))).toBe(true);
    });

    it("should print timed out status", () => {
      const reporter = createReporter({ noColor: true });

      reporter.printProgress({
        name: "test",
        status: "error",
        action: "timed_out",
        error: 'Command "brew install test" timed out after 5000ms: Timed out after 5000ms',
      });

      expect(output.some((line) => line.includes("timed out"))).toBe(true);
      expect(output.some((line) => line.includes("Reason:"))).toBe(true);
    });

    it("should print blocked status", () => {
      const reporter = createReporter({ noColor: true });

      reporter.printProgress({
        name: "test",
        status: "blocked",
        action: "blocked",
        error: "Blocked by unsuccessful dependency: homebrew",
      });

      expect(output.some((line) => line.includes("blocked by dependency"))).toBe(true);
      expect(output.some((line) => line.includes("homebrew"))).toBe(true);
    });

    it("should print preview labels and steps when provided", () => {
      const reporter = createReporter({ noColor: true });

      reporter.printProgress({
        name: "test",
        status: "missing",
        action: "skipped",
        preview: {
          label: "shell install command",
          steps: ["brew install test"],
        },
      });

      expect(output.some((line) => line.includes("shell install command"))).toBe(true);
      expect(output.some((line) => line.includes("brew install test"))).toBe(true);
    });
  });

  describe("printSummary", () => {
    it("should print summary counts", () => {
      const reporter = createReporter({ noColor: true });

      const results: ExecutionResult[] = [
        { name: "a", status: "installed", action: "installed" },
        { name: "b", status: "installed", action: "skipped" },
        { name: "c", status: "missing", action: "skipped" },
      ];

      reporter.printSummary(results);

      expect(output.some((line) => line.includes("Summary"))).toBe(true);
      expect(output.some((line) => line.includes("1 installed"))).toBe(true);
      expect(output.some((line) => line.includes("1 already installed"))).toBe(true);
      expect(output.some((line) => line.includes("1 would be installed"))).toBe(true);
    });

    it("should show backup count when files were backed up", () => {
      const reporter = createReporter({ noColor: true });

      const results: ExecutionResult[] = [
        { name: "a", status: "installed", action: "installed", backed_up: "/backup/a" },
        { name: "b", status: "installed", action: "installed", backed_up: "/backup/b" },
      ];

      reporter.printSummary(results);

      expect(output.some((line) => line.includes("2 files backed up"))).toBe(true);
    });

    it("should show updated and would_update counts", () => {
      const reporter = createReporter({ noColor: true });

      const results: ExecutionResult[] = [
        { name: "a", status: "installed", action: "updated" },
        { name: "b", status: "installed", action: "would_update" },
        { name: "c", status: "installed", action: "updated" },
      ];

      reporter.printSummary(results);

      expect(output.some((line) => line.includes("2 updated"))).toBe(true);
      expect(output.some((line) => line.includes("1 would be updated"))).toBe(true);
    });

    it("should print failure details in summary", () => {
      const reporter = createReporter({ noColor: true });

      const results: ExecutionResult[] = [
        {
          name: "claude-code",
          status: "error",
          action: "failed",
          error: 'Command "claude update" failed with exit code 1: network unavailable',
        },
      ];

      reporter.printSummary(results);

      expect(output.some((line) => line.includes("1 failed"))).toBe(true);
      expect(output.some((line) => line.includes("claude-code:"))).toBe(true);
      expect(output.some((line) => line.includes("network unavailable"))).toBe(true);
    });

    it("should print timed out and blocked counts", () => {
      const reporter = createReporter({ noColor: true });

      const results: ExecutionResult[] = [
        {
          name: "homebrew",
          status: "error",
          action: "timed_out",
          error: 'Command "brew install homebrew" timed out after 5000ms: Timed out after 5000ms',
        },
        {
          name: "neovim",
          status: "blocked",
          action: "blocked",
          error: "Blocked by unsuccessful dependency: homebrew",
        },
      ];

      reporter.printSummary(results);

      expect(output.some((line) => line.includes("1 timed out"))).toBe(true);
      expect(output.some((line) => line.includes("1 blocked by dependencies"))).toBe(true);
      expect(output.some((line) => line.includes("homebrew:"))).toBe(true);
      expect(output.some((line) => line.includes("neovim:"))).toBe(true);
    });
  });

  describe("printStatus", () => {
    it("should print status rows and summary counts", () => {
      const reporter = createReporter({ noColor: true });

      const results: InspectionResult[] = [
        { name: "git", status: "installed" },
        { name: "ripgrep", status: "missing" },
        {
          name: "dotfiles",
          status: "updateable",
          detail: "update symlink /Users/test/.zshrc -> /Users/test/.dotfiles/.zshrc",
          reason: "Symlink target differs from the desired target.",
        },
        {
          name: "neovim",
          status: "blocked",
          reason: "Blocked by dependency that is not ready: homebrew (missing)",
        },
      ];

      reporter.printStatus(results);

      expect(output.some((line) => line.includes("Status:"))).toBe(true);
      expect(output.some((line) => line.includes("git") && line.includes("installed"))).toBe(true);
      expect(output.some((line) => line.includes("ripgrep") && line.includes("missing"))).toBe(
        true,
      );
      expect(output.some((line) => line.includes("dotfiles") && line.includes("updateable"))).toBe(
        true,
      );
      expect(output.some((line) => line.includes("neovim") && line.includes("blocked"))).toBe(true);
      expect(output.some((line) => line.includes("1 updateable"))).toBe(true);
      expect(output.some((line) => line.includes("1 blocked"))).toBe(true);
    });
  });

  describe("printWhy", () => {
    it("should print a why-selected report", () => {
      const reporter = createReporter({ noColor: true });

      reporter.printWhy({
        itemName: "homebrew",
        selected: true,
        lines: [
          'Selected because it is required as a dependency of "ffmpeg".',
          "Dependency path: ffmpeg -> homebrew",
        ],
      });

      expect(output.some((line) => line.includes("Why Selected:"))).toBe(true);
      expect(output.some((line) => line.includes("Dependency path: ffmpeg -> homebrew"))).toBe(
        true,
      );
    });

    it("should print a why-not-selected report", () => {
      const reporter = createReporter({ noColor: true });

      reporter.printWhy({
        itemName: "slack",
        selected: false,
        lines: [
          "Item exists in the resolved config but is not selected by the active filters.",
          "--only currently selects: git, neovim",
        ],
      });

      expect(output.some((line) => line.includes("Why Not Selected:"))).toBe(true);
      expect(output.some((line) => line.includes("--only currently selects: git, neovim"))).toBe(
        true,
      );
    });
  });

  describe("printVerbose", () => {
    it("should print verbose messages when verbose mode is enabled", () => {
      const reporter = createReporter({ noColor: true, verbose: true });

      reporter.printVerbose("[test] install: brew install test");

      expect(output.some((line) => line.includes("[test] install: brew install test"))).toBe(true);
    });

    it("should not print verbose messages when verbose mode is disabled", () => {
      const reporter = createReporter({ noColor: true });

      reporter.printVerbose("[test] install: brew install test");

      expect(output).toHaveLength(0);
    });
  });
});
