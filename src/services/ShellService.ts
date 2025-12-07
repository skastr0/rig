import { Context, Effect, Layer, Duration } from "effect"
import { ShellError } from "../errors.js"

export interface ShellResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export interface ShellService {
  /** Run a shell command string (via sh -c). Use for user-configured commands only. */
  readonly run: (
    command: string,
    options?: { timeout?: Duration.DurationInput }
  ) => Effect.Effect<ShellResult, ShellError>

  /** Execute a command with explicit args (no shell interpolation). Safe from injection. */
  readonly exec: (
    command: string,
    args: readonly string[],
    options?: { timeout?: Duration.DurationInput; cwd?: string }
  ) => Effect.Effect<ShellResult, ShellError>
}

export const ShellService = Context.GenericTag<ShellService>("ShellService")

const spawnProcess = (
  args: readonly string[],
  options?: { timeout?: Duration.DurationInput; cwd?: string }
): Effect.Effect<ShellResult, ShellError> =>
  Effect.tryPromise({
    try: async () => {
      const timeout = options?.timeout
        ? Duration.toMillis(options.timeout)
        : 30_000

      const proc = Bun.spawn(args as string[], {
        stdout: "pipe",
        stderr: "pipe",
        ...(options?.cwd ? { cwd: options.cwd } : {}),
      })

      const timeoutId = setTimeout(() => {
        proc.kill()
      }, timeout)

      try {
        const exitCode = await proc.exited
        clearTimeout(timeoutId)

        const stdout = await new Response(proc.stdout).text()
        const stderr = await new Response(proc.stderr).text()

        return { stdout, stderr, exitCode }
      } catch {
        clearTimeout(timeoutId)
        throw new Error("Process failed")
      }
    },
    catch: () =>
      new ShellError({
        command: args.join(" "),
        exitCode: -1,
        stderr: "Process execution failed",
      }),
  }).pipe(
    Effect.flatMap((result) =>
      result.exitCode !== 0
        ? Effect.fail(
            new ShellError({
              command: args.join(" "),
              exitCode: result.exitCode,
              stderr: result.stderr,
            })
          )
        : Effect.succeed(result)
    )
  )

export const ShellServiceLive = Layer.succeed(
  ShellService,
  ShellService.of({
    run: (command, options) => spawnProcess(["sh", "-c", command], options),

    exec: (command, args, options) => spawnProcess([command, ...args], options),
  })
)
