import { describe, it, expect } from "vitest"
import { Effect, Exit } from "effect"
import { topologicalSort } from "../src/engine/Planner.js"
import type { SystemItem } from "../src/schema/config.js"
import { CycleError, ValidationError } from "../src/errors.js"

const makeItem = (
  name: string,
  dependsOn?: string[]
): SystemItem => ({
  name,
  check: `which ${name}`,
  install: `brew install ${name}`,
  dependsOn,
})

describe("Planner", () => {
  describe("topologicalSort", () => {
    it("should sort items with no dependencies", async () => {
      const items = [makeItem("a"), makeItem("b"), makeItem("c")]

      const result = await Effect.runPromise(topologicalSort(items))

      expect(result.sorted).toHaveLength(3)
      expect(result.levels).toHaveLength(1)
      expect(result.levels[0]).toHaveLength(3)
    })

    it("should sort items with linear dependencies", async () => {
      const items = [
        makeItem("c", ["b"]),
        makeItem("b", ["a"]),
        makeItem("a"),
      ]

      const result = await Effect.runPromise(topologicalSort(items))

      expect(result.sorted.map((i) => i.name)).toEqual(["a", "b", "c"])
      expect(result.levels).toHaveLength(3)
      expect(result.levels[0].map((i) => i.name)).toEqual(["a"])
      expect(result.levels[1].map((i) => i.name)).toEqual(["b"])
      expect(result.levels[2].map((i) => i.name)).toEqual(["c"])
    })

    it("should group items that can run in parallel", async () => {
      const items = [
        makeItem("a"),
        makeItem("b"),
        makeItem("c", ["a", "b"]),
      ]

      const result = await Effect.runPromise(topologicalSort(items))

      expect(result.levels).toHaveLength(2)
      expect(result.levels[0].map((i) => i.name).sort()).toEqual(["a", "b"])
      expect(result.levels[1].map((i) => i.name)).toEqual(["c"])
    })

    it("should detect cycles", async () => {
      const items = [
        makeItem("a", ["b"]),
        makeItem("b", ["a"]),
      ]

      const exit = await Effect.runPromiseExit(topologicalSort(items))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = exit.cause
        expect(error._tag).toBe("Fail")
        if (error._tag === "Fail") {
          expect(error.error).toBeInstanceOf(CycleError)
        }
      }
    })

    it("should detect longer cycles", async () => {
      const items = [
        makeItem("a", ["c"]),
        makeItem("b", ["a"]),
        makeItem("c", ["b"]),
      ]

      const exit = await Effect.runPromiseExit(topologicalSort(items))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = exit.cause
        if (error._tag === "Fail") {
          expect(error.error).toBeInstanceOf(CycleError)
        }
      }
    })

    it("should reject unknown dependencies", async () => {
      const items = [makeItem("a", ["unknown"])]

      const exit = await Effect.runPromiseExit(topologicalSort(items))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = exit.cause
        if (error._tag === "Fail") {
          expect(error.error).toBeInstanceOf(ValidationError)
          if (error.error instanceof ValidationError) {
            expect(error.error.issues[0]).toContain("unknown")
          }
        }
      }
    })

    it("should handle complex dependency graphs", async () => {
      const items = [
        makeItem("d", ["b", "c"]),
        makeItem("c", ["a"]),
        makeItem("b", ["a"]),
        makeItem("a"),
        makeItem("e", ["d"]),
      ]

      const result = await Effect.runPromise(topologicalSort(items))

      const indexOf = (name: string) =>
        result.sorted.findIndex((i) => i.name === name)

      expect(indexOf("a")).toBeLessThan(indexOf("b"))
      expect(indexOf("a")).toBeLessThan(indexOf("c"))
      expect(indexOf("b")).toBeLessThan(indexOf("d"))
      expect(indexOf("c")).toBeLessThan(indexOf("d"))
      expect(indexOf("d")).toBeLessThan(indexOf("e"))
    })
  })
})
