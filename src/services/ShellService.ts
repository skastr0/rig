import { Context, Effect, Layer, Duration } from "effect"
import { ShellError } from "../errors.js"

export interface ShellResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export interface ShellService {
  readonly run: (
    command: string,
    options?: { timeout?: Duration.DurationInput }
  ) => Effect.Effect<ShellResult, ShellError>
}

export const ShellService = Context.GenericTag<ShellService>("ShellService")

export const ShellServiceLive = Layer.succeed(
  ShellService,
  ShellService.of({
    run: (command, options) =>
      Effect.tryPromise({
        try: async () => {
          const timeout = options?.timeout
            ? Duration.toMillis(options.timeout)
            : 30_000

          const proc = Bun.spawn(["sh", "-c", command], {
            stdout: "pipe",
            stderr: "pipe",
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
            command,
            exitCode: -1,
            stderr: "Process execution failed",
          }),
      }).pipe(
        Effect.flatMap((result) =>
          result.exitCode !== 0
            ? Effect.fail(
                new ShellError({
                  command,
                  exitCode: result.exitCode,
                  stderr: result.stderr,
                })
              )
            : Effect.succeed(result)
        )
      ),
  })
)
