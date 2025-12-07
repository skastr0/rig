import { Effect } from "effect"
import type { SystemItem } from "../schema/config.js"
import { CycleError, ValidationError } from "../errors.js"

export interface PlanResult {
  readonly sorted: readonly SystemItem[]
  readonly levels: readonly (readonly SystemItem[])[]
}

const validateDependencies = (
  items: readonly SystemItem[]
): Effect.Effect<void, ValidationError> => {
  const names = new Set(items.map((item) => item.name))
  const issues: string[] = []

  for (const item of items) {
    if (item.dependsOn) {
      for (const dep of item.dependsOn) {
        if (!names.has(dep)) {
          issues.push(`Item "${item.name}" depends on unknown item "${dep}"`)
        }
      }
    }
  }

  return issues.length > 0
    ? Effect.fail(new ValidationError({ issues }))
    : Effect.succeed(undefined)
}

const detectCycle = (
  items: readonly SystemItem[]
): Effect.Effect<void, CycleError> => {
  const itemMap = new Map(items.map((item) => [item.name, item]))
  const visited = new Set<string>()
  const recursionStack = new Set<string>()
  const path: string[] = []

  const dfs = (name: string): string[] | null => {
    visited.add(name)
    recursionStack.add(name)
    path.push(name)

    const item = itemMap.get(name)
    if (item?.dependsOn) {
      for (const dep of item.dependsOn) {
        if (!visited.has(dep)) {
          const cycle = dfs(dep)
          if (cycle) return cycle
        } else if (recursionStack.has(dep)) {
          const cycleStart = path.indexOf(dep)
          return [...path.slice(cycleStart), dep]
        }
      }
    }

    path.pop()
    recursionStack.delete(name)
    return null
  }

  for (const item of items) {
    if (!visited.has(item.name)) {
      const cycle = dfs(item.name)
      if (cycle) {
        return Effect.fail(new CycleError({ cycle }))
      }
    }
  }

  return Effect.succeed(undefined)
}

const kahnSort = (
  items: readonly SystemItem[]
): { sorted: SystemItem[]; levels: SystemItem[][] } => {
  const itemMap = new Map(items.map((item) => [item.name, item]))
  const inDegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()

  for (const item of items) {
    inDegree.set(item.name, 0)
    dependents.set(item.name, [])
  }

  for (const item of items) {
    if (item.dependsOn) {
      inDegree.set(item.name, item.dependsOn.length)
      for (const dep of item.dependsOn) {
        dependents.get(dep)!.push(item.name)
      }
    }
  }

  const sorted: SystemItem[] = []
  const levels: SystemItem[][] = []

  let currentLevel = items.filter((item) => inDegree.get(item.name) === 0)

  while (currentLevel.length > 0) {
    levels.push([...currentLevel])
    sorted.push(...currentLevel)

    const nextLevel: SystemItem[] = []

    for (const item of currentLevel) {
      for (const dependent of dependents.get(item.name)!) {
        const newDegree = inDegree.get(dependent)! - 1
        inDegree.set(dependent, newDegree)
        if (newDegree === 0) {
          nextLevel.push(itemMap.get(dependent)!)
        }
      }
    }

    currentLevel = nextLevel
  }

  return { sorted, levels }
}

export const topologicalSort = (
  items: readonly SystemItem[]
): Effect.Effect<PlanResult, CycleError | ValidationError> =>
  Effect.gen(function* () {
    yield* validateDependencies(items)
    yield* detectCycle(items)

    const { sorted, levels } = kahnSort(items)

    return { sorted, levels } as PlanResult
  })
