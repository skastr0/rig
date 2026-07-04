import { arch, platform } from "os";
import type { Target } from "./compile";

export function detectHostTarget(): Target {
  const os = platform();
  const cpu = arch();

  let platformStr: Target["platform"];
  switch (os) {
    case "darwin":
      platformStr = "darwin";
      break;
    case "linux":
      platformStr = "linux";
      break;
    default:
      console.error(`Unsupported operating system: ${os}`);
      process.exit(1);
  }

  let archStr: Target["arch"];
  switch (cpu) {
    case "x64":
      archStr = "x64";
      break;
    case "arm64":
      archStr = "arm64";
      break;
    default:
      console.error(`Unsupported architecture: ${cpu}`);
      process.exit(1);
  }

  return { platform: platformStr, arch: archStr };
}
