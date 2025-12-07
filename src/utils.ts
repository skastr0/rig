import * as Os from "node:os"

/**
 * Expands path shortcuts like ~ (tilde) to the user's home directory.
 * Also handles $HOME environment variable expansion.
 *
 * @param path - The path to expand
 * @returns The expanded path with home directory resolved
 *
 * @example
 * expandPath("~/Documents") // "/Users/username/Documents"
 * expandPath("$HOME/Documents") // "/Users/username/Documents"
 * expandPath("/absolute/path") // "/absolute/path"
 */
export const expandPath = (path: string): string => {
  const homeDir = Os.homedir()
  return path.replace(/^~/, homeDir).replace(/^\$HOME/, homeDir)
}
