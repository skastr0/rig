import { describe, expect, it } from "vitest";
import type { SystemItem } from "../schema/config.js";
import { selectItems } from "./Selection.js";

const makeItem = (
  name: string,
  options?: Partial<Pick<SystemItem, "dependsOn" | "tags">>,
): SystemItem => ({
  name,
  check: `which ${name}`,
  install: `brew install ${name}`,
  dependsOn: options?.dependsOn,
  tags: options?.tags,
});

describe("selectItems", () => {
  it("includes dependencies for --only selections", () => {
    const items = [
      makeItem("homebrew"),
      makeItem("ffmpeg", { dependsOn: ["homebrew"], tags: ["media"] }),
    ];

    const selected = selectItems(items, { only: ["ffmpeg"], tags: [] });

    expect(selected.map((item) => item.name)).toEqual(["homebrew", "ffmpeg"]);
  });

  it("includes dependencies for tag selections", () => {
    const items = [
      makeItem("homebrew"),
      makeItem("ffmpeg", { dependsOn: ["homebrew"], tags: ["media"] }),
    ];

    const selected = selectItems(items, { only: [], tags: ["media"] });

    expect(selected.map((item) => item.name)).toEqual(["homebrew", "ffmpeg"]);
  });

  it("keeps --only and --tags as an intersection before expanding dependencies", () => {
    const items = [
      makeItem("homebrew"),
      makeItem("ffmpeg", { dependsOn: ["homebrew"], tags: ["media"] }),
      makeItem("ripgrep", { dependsOn: ["homebrew"], tags: ["dev"] }),
    ];

    const selected = selectItems(items, { only: ["ffmpeg", "ripgrep"], tags: ["media"] });

    expect(selected.map((item) => item.name)).toEqual(["homebrew", "ffmpeg"]);
  });

  it("includes transitive dependencies", () => {
    const items = [
      makeItem("homebrew"),
      makeItem("yt-dlp", { dependsOn: ["homebrew"] }),
      makeItem("media-workflow", { dependsOn: ["yt-dlp"], tags: ["media"] }),
    ];

    const selected = selectItems(items, { only: ["media-workflow"], tags: [] });

    expect(selected.map((item) => item.name)).toEqual(["homebrew", "yt-dlp", "media-workflow"]);
  });
});
