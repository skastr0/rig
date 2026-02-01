import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect } from "effect";
import { createReporter } from "./Reporter.js";
import { topologicalSort } from "./Planner.js";
import type { ExecutionResult } from "./Executor.js";
import type { SystemItem } from "../schema/config.js";

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
  });
});
