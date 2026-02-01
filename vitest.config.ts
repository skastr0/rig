import { defineConfig } from "vitest/config";
import * as path from "node:path";

export default defineConfig({
  esbuild: {
    target: "es2020",
  },
  test: {
    setupFiles: [path.join(__dirname, "vitest.setup.ts")],
    fakeTimers: {
      toFake: undefined,
    },
    sequence: {
      concurrent: false,
      shuffle: false,
    },
    fileParallelism: false,
    include: ["src/**/*.test.ts"],
    pool: "forks",
  },
});
