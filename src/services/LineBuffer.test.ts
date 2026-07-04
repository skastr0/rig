import { describe, expect, it } from "vitest";
import { createLineBuffer } from "./LineBuffer.js";

const maxBufferedLineLength = 16_384;

describe("createLineBuffer", () => {
  it("emits complete lines from split fragments and flushes the final fragment", () => {
    const lines: string[] = [];
    const buffer = createLineBuffer(
      (line) => lines.push(line),
      (error) => {
        throw error;
      },
    );

    buffer.push("Inst");
    buffer.push("alling package\nNext");
    buffer.push(" step");

    expect(lines).toEqual(["Installing package"]);

    buffer.flush();

    expect(lines).toEqual(["Installing package", "Next step"]);
  });

  it("preserves empty logical lines without adding an extra line on flush", () => {
    const lines: string[] = [];
    const buffer = createLineBuffer(
      (line) => lines.push(line),
      (error) => {
        throw error;
      },
    );

    buffer.push("first\n\nlast\n");
    buffer.flush();

    expect(lines).toEqual(["first", "", "last"]);
  });

  it("treats carriage returns and CRLF as line boundaries", () => {
    const lines: string[] = [];
    const buffer = createLineBuffer(
      (line) => lines.push(line),
      (error) => {
        throw error;
      },
    );

    buffer.push("downloading 10%\r\n");
    buffer.push("downloading 20%\rdone");
    buffer.flush();

    expect(lines).toEqual(["downloading 10%", "downloading 20%", "done"]);
  });

  it("routes callback errors without throwing from the buffer", () => {
    const errors: unknown[] = [];
    const buffer = createLineBuffer(
      () => {
        throw new Error("sink failed");
      },
      (error) => errors.push(error),
    );

    expect(() => buffer.push("broken line\n")).not.toThrow();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect((errors[0] as Error).message).toBe("sink failed");
  });

  it("bounds newline-free output", () => {
    const lines: string[] = [];
    const buffer = createLineBuffer(
      (line) => lines.push(line),
      (error) => {
        throw error;
      },
    );

    buffer.push("x".repeat(17_000));
    buffer.flush();

    expect(lines.map((line) => line.length)).toEqual([
      maxBufferedLineLength,
      17_000 - maxBufferedLineLength,
    ]);
  });
});
