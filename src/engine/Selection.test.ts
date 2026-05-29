import { describe, expect, it } from "vitest";
import type { SystemItem } from "../schema/config.js";
import { analyzeSelection, selectItems } from "./Selection.js";

const makeItem = (
  name: string,
  options?: Partial<Pick<SystemItem, "dependsOn" | "profiles" | "tags">>,
): SystemItem => ({
  name,
  profiles: options?.profiles ?? ["macbook"],
  tags: options?.tags ?? ["base"],
  check: `which ${name}`,
  install: `brew install ${name}`,
  dependsOn: options?.dependsOn,
});

const macbookSelection = (options?: {
  readonly only?: readonly string[];
  readonly tags?: readonly string[];
}) => ({
  profile: "macbook",
  only: options?.only ?? [],
  tags: options?.tags ?? [],
});

describe("selectItems", () => {
  it("includes dependencies for --only selections", () => {
    const items = [
      makeItem("homebrew"),
      makeItem("ffmpeg", { dependsOn: ["homebrew"], tags: ["media"] }),
    ];

    const selected = selectItems(items, macbookSelection({ only: ["ffmpeg"] }));

    expect(selected.map((item) => item.name)).toEqual(["homebrew", "ffmpeg"]);
  });

  it("includes dependencies for tag selections", () => {
    const items = [
      makeItem("homebrew"),
      makeItem("ffmpeg", { dependsOn: ["homebrew"], tags: ["media"] }),
    ];

    const selected = selectItems(items, macbookSelection({ tags: ["media"] }));

    expect(selected.map((item) => item.name)).toEqual(["homebrew", "ffmpeg"]);
  });

  it("keeps --only and --tags as an intersection before expanding dependencies", () => {
    const items = [
      makeItem("homebrew"),
      makeItem("ffmpeg", { dependsOn: ["homebrew"], tags: ["media"] }),
      makeItem("ripgrep", { dependsOn: ["homebrew"], tags: ["dev"] }),
    ];

    const selected = selectItems(
      items,
      macbookSelection({ only: ["ffmpeg", "ripgrep"], tags: ["media"] }),
    );

    expect(selected.map((item) => item.name)).toEqual(["homebrew", "ffmpeg"]);
  });

  it("returns an empty selection when filters match nothing", () => {
    const items = [makeItem("ffmpeg", { tags: ["media"] })];

    const selection = analyzeSelection(
      items,
      macbookSelection({ only: ["ripgrep"], tags: ["dev"] }),
    );

    expect(selection.selectedItems).toEqual([]);
    expect(selection.selectedNames.size).toBe(0);
    expect(selection.matchedNames.size).toBe(0);
    expect(selection.reasons.size).toBe(0);
  });

  it("includes transitive dependencies", () => {
    const items = [
      makeItem("homebrew"),
      makeItem("yt-dlp", { dependsOn: ["homebrew"] }),
      makeItem("media-workflow", { dependsOn: ["yt-dlp"], tags: ["media"] }),
    ];

    const selected = selectItems(items, macbookSelection({ only: ["media-workflow"] }));

    expect(selected.map((item) => item.name)).toEqual(["homebrew", "yt-dlp", "media-workflow"]);
  });

  it("records direct filter matches for why introspection", () => {
    const items = [makeItem("ffmpeg", { tags: ["media", "cli"] })];

    const selection = analyzeSelection(
      items,
      macbookSelection({ only: ["ffmpeg"], tags: ["media"] }),
    );
    const reason = selection.reasons.get("ffmpeg");

    expect(reason).toEqual({
      type: "direct",
      profile: "macbook",
      matchedOnly: true,
      matchedTags: ["media"],
    });
  });

  it("records dependency paths for why introspection", () => {
    const items = [
      makeItem("homebrew"),
      makeItem("yt-dlp", { dependsOn: ["homebrew"] }),
      makeItem("media-workflow", { dependsOn: ["yt-dlp"], tags: ["media"] }),
    ];

    const selection = analyzeSelection(items, macbookSelection({ only: ["media-workflow"] }));
    const reason = selection.reasons.get("homebrew");

    expect(reason).toEqual({
      type: "dependency",
      rootProfile: "macbook",
      path: ["media-workflow", "yt-dlp", "homebrew"],
    });
  });

  it("does not pull dependencies outside the active profile", () => {
    const items = [
      makeItem("tailscale", { profiles: ["macbook"] }),
      makeItem("matrix-server", {
        profiles: ["server-home"],
        tags: ["matrix"],
        dependsOn: ["tailscale"],
      }),
    ];

    const selection = analyzeSelection(items, {
      profile: "server-home",
      only: [],
      tags: ["matrix"],
    });

    expect(selection.selectedItems.map((item) => item.name)).toEqual(["matrix-server"]);
    expect(selection.reasons.get("tailscale")).toBeUndefined();
  });
});
