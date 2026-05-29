# Rig - Effect Development Guidelines

Guidelines for writing Effect-based TypeScript in this codebase.

## Single Runtime Pattern (CRITICAL)

**NEVER call `Effect.provide(AppLayer)` multiple times!**

Each call creates NEW service instances with separate state. Use a single `ManagedRuntime`:

```typescript
// src/runtime.ts - Create ONCE
import { ManagedRuntime } from "effect";
import { AppLayer } from "./services/AppLayer";

export const AppRuntime = ManagedRuntime.make(AppLayer);

// Usage everywhere:
import { AppRuntime } from "./runtime";

AppRuntime.runPromise(effect);
AppRuntime.runSync(effect);
```

**FORBIDDEN:**

```typescript
// Creates separate service instances!
Effect.runPromise(program.pipe(Effect.provide(AppLayer)));
```

## Effect.gen Patterns

### Basic Composition

```typescript
const program = Effect.gen(function* () {
  const config = yield* ConfigService;
  const items = yield* config.load();
  return items;
});
```

### MANDATORY: Return Yield for Errors

**ALWAYS use `return yield*` when yielding errors:**

```typescript
Effect.gen(function* () {
  if (someCondition) {
    return yield* Effect.fail(new ValidationError({ issues: ["..."] }));
  }

  const result = yield* someEffect;
  return result;
});
```

### FORBIDDEN: try-catch in Effect.gen

**NEVER use try-catch inside generators:**

```typescript
// WRONG
Effect.gen(function* () {
  try {
    const result = yield* someEffect;
  } catch (error) {
    // Never reached!
  }
});

// CORRECT
Effect.gen(function* () {
  const result = yield* Effect.result(someEffect);
  if (result._tag === "Failure") {
    // Handle error
  }
});
```

## Service Pattern

### Define Service with Context.Tag

```typescript
// src/services/ShellService.ts
import { Context, Effect, Data, Layer, Duration } from "effect";

// Error type
export class ShellError extends Data.TaggedError("ShellError")<{
  command: string;
  exitCode: number;
  stderr: string;
}> {}

// Result type
export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Service definition
export class ShellService extends Context.Tag("ShellService")<
  ShellService,
  {
    readonly run: (
      cmd: string,
      timeout?: Duration.Duration,
    ) => Effect.Effect<ShellResult, ShellError>;
  }
>() {}

// Live implementation
export const ShellServiceLive = Layer.succeed(ShellService, {
  run: (cmd, timeout) =>
    Effect.gen(function* () {
      // Implementation using Bun.spawn
    }),
});
```

### Compose Layers

```typescript
// src/services/AppLayer.ts
import { Layer } from "effect";

export const AppLayer = Layer.mergeAll(
  ConfigServiceLive,
  ShellServiceLive,
  BackupServiceLive,
  GitServiceLive,
);
```

## Error Handling

### Tagged Errors

```typescript
import { Data } from "effect";

export class ConfigError extends Data.TaggedError("ConfigError")<{
  message: string;
  path?: string;
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  issues: string[];
}> {}

export class CycleError extends Data.TaggedError("CycleError")<{
  cycle: string[];
}> {}
```

### Effect.try for Sync Operations

```typescript
yield *
  Effect.try({
    try: () => JSON.parse(content),
    catch: (error) =>
      new ConfigError({
        message: `Invalid JSON: ${error}`,
        path: configPath,
      }),
  });
```

### Effect.tryPromise for Async

```typescript
yield *
  Effect.tryPromise({
    try: () => Bun.file(path).text(),
    catch: (error) =>
      new ConfigError({
        message: `Failed to read file: ${error}`,
        path,
      }),
  });
```

## Schema Validation

### Import Pattern

```typescript
import { Schema } from "effect";
// NOT: import { Schema } from "@effect/schema"
```

### Define Schemas

```typescript
const SystemItem = Schema.Struct({
  name: Schema.String,
  check: Schema.String,
  onCheck: Schema.optional(Schema.Literal("exit-code", "path-exists")),
  install: Schema.Union(
    Schema.String,
    Schema.Struct({
      source: Schema.Literal("git"),
      repo: Schema.String,
      path: Schema.String,
    }),
  ),
  update: Schema.optional(Schema.String),
  group: Schema.optional(Schema.String),
  dependsOn: Schema.optional(Schema.Array(Schema.String)),
});

// Infer TypeScript type
type SystemItem = Schema.Schema.Type<typeof SystemItem>;
```

### Validate in Effects

```typescript
const loadConfig = (path: string) =>
  Effect.gen(function* () {
    const content = yield* Effect.tryPromise({
      try: () => Bun.file(path).text(),
      catch: () => new ConfigError({ message: "File not found", path }),
    });

    const parsed = yield* Effect.try({
      try: () => JSON.parse(content),
      catch: () => new ConfigError({ message: "Invalid JSON", path }),
    });

    const config = yield* Schema.decodeUnknown(SystemConfig)(parsed).pipe(
      Effect.mapError(
        (e) =>
          new ValidationError({
            issues: [String(e)],
          }),
      ),
    );

    return config;
  });
```

## Concurrency

### Parallel Execution with forEach

```typescript
yield *
  Effect.forEach(
    items,
    (item) => processItem(item),
    { concurrency: 4 }, // or "unbounded"
  );
```

### Serial Execution for Groups (Semaphore)

```typescript
import { Semaphore, HashMap } from "effect";

const executeWithGroups = (items: SystemItem[]) =>
  Effect.gen(function* () {
    // Create semaphore per group
    const semaphores = yield* Effect.forEach(uniqueGroups, (group) =>
      Effect.map(
        Semaphore.make(1), // concurrency 1 = serial
        (sem) => [group, sem] as const,
      ),
    ).pipe(Effect.map(HashMap.fromIterable));

    // Execute with semaphore
    yield* Effect.forEach(
      items,
      (item) => {
        const sem = HashMap.unsafeGet(semaphores, item.group ?? item.name);
        return Semaphore.withPermits(sem, 1)(executeItem(item));
      },
      { concurrency: "unbounded" },
    );
  });
```

## TypeScript Rules

### FORBIDDEN: Type Assertions

```typescript
// NEVER do this
const value = something as any;
const value = something as never;
const value = something as unknown;
```

### MANDATORY: Explicit Types

Add type annotations when inference fails:

```typescript
// Good
const items: SystemItem[] = []

// Good - explicit generic
Effect.forEach<SystemItem, void, ShellError>(items, ...)
```

## Testing with @effect/vitest

### Import Pattern

```typescript
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
```

### Test Effects with it.effect

```typescript
describe("ConfigService", () => {
  it.effect("should load valid config", () =>
    Effect.gen(function* () {
      const config = yield* ConfigService;
      const result = yield* config.load("./test-config.json");

      assert.strictEqual(result.items.length, 3);
      assert.isTrue(result.items[0].name === "homebrew");
    }),
  );

  it.effect("should fail on invalid config", () =>
    Effect.gen(function* () {
      const config = yield* ConfigService;
      const result = yield* Effect.exit(config.load("./invalid.json"));

      assert.isTrue(result._tag === "Failure");
    }),
  );
});
```

### Use Layer for Test Dependencies

```typescript
const TestLayer = ConfigServiceLive.pipe(Layer.provideMerge(ShellServiceLive));

layer(TestLayer)("ConfigService", (it) => {
  it.effect("test case", () =>
    Effect.gen(function* () {
      // ...
    }),
  );
});
```

## Code Style

- No comments unless explicitly requested
- Prefer early returns
- Use `Effect.gen` over `Effect.flatMap` chains
- Keep services focused (single responsibility)
- Validate at boundaries (config loading, CLI args)

## File Organization

```
src/
  index.ts          # CLI entry, no business logic
  runtime.ts        # Single ManagedRuntime
  errors.ts         # All TaggedError definitions
  schema/
    config.ts       # Schema definitions
    validation.ts   # Config validation logic
  services/
    ConfigService.ts
    ShellService.ts
    AppLayer.ts     # Layer composition
  engine/
    Planner.ts
    Executor.ts
```

## Quick Reference

| Pattern                 | Usage                        |
| ----------------------- | ---------------------------- |
| `yield*`                | Access service or run effect |
| `return yield*`         | Terminate with error         |
| `Effect.gen`            | Compose effects              |
| `Effect.try`            | Wrap sync throwing code      |
| `Effect.tryPromise`     | Wrap async throwing code     |
| `Effect.forEach`        | Parallel/serial iteration    |
| `Semaphore.withPermits` | Concurrency control          |
| `Schema.decodeUnknown`  | Validate unknown input       |
| `Data.TaggedError`      | Define error types           |
| `Context.Tag`           | Define service interface     |
| `Layer.succeed`         | Create service layer         |
| `Layer.mergeAll`        | Compose layers               |
