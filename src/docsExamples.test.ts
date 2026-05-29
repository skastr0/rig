import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { SystemConfig } from "./schema/config.js";

const docs = ["README.md", "USAGE.md", "ARCHITECTURE.md"] as const;

const jsonBlocks = (content: string): readonly string[] =>
  [...content.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1] ?? "");

describe("documentation config examples", () => {
  it("keeps copyable item examples aligned with the schema", async () => {
    for (const doc of docs) {
      const content = readFileSync(doc, "utf8");

      for (const [index, block] of jsonBlocks(content).entries()) {
        if (!block.includes('"items"') && !block.includes('"name"')) {
          continue;
        }

        const parsed = JSON.parse(block) as unknown;
        const config = block.includes('"items"') ? parsed : { items: [parsed] };

        await expect(
          Effect.runPromise(Schema.decodeUnknown(SystemConfig)(config)),
          `${doc} json block ${index + 1}`,
        ).resolves.toBeDefined();
      }
    }
  });
});
