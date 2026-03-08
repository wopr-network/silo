import { describe, expect, it } from "vitest";
import { splitShellWords } from "../../src/engine/shell-words.js";

describe("splitShellWords", () => {
  it("splits simple unquoted words", () => {
    expect(splitShellWords("echo hello world")).toEqual(["echo", "hello", "world"]);
  });

  it("preserves single-quoted strings", () => {
    expect(splitShellWords("jq '.foo bar'")).toEqual(["jq", ".foo bar"]);
  });

  it("preserves double-quoted strings", () => {
    expect(splitShellWords('echo "hello world"')).toEqual(["echo", "hello world"]);
  });

  it("handles backslash escapes outside quotes", () => {
    expect(splitShellWords("echo hello\\ world")).toEqual(["echo", "hello world"]);
  });

  it("handles backslash escapes inside double quotes", () => {
    expect(splitShellWords('echo "hello\\"world"')).toEqual(["echo", 'hello"world']);
  });

  it("handles mixed quoting styles", () => {
    expect(splitShellWords(`gates/check.sh --name "John Doe" --filter '.status == "active"'`)).toEqual([
      "gates/check.sh",
      "--name",
      "John Doe",
      "--filter",
      '.status == "active"',
    ]);
  });

  it("handles multiple spaces between words", () => {
    expect(splitShellWords("echo   hello    world")).toEqual(["echo", "hello", "world"]);
  });

  it("handles leading and trailing whitespace", () => {
    expect(splitShellWords("  echo hello  ")).toEqual(["echo", "hello"]);
  });

  it("returns empty array for empty string", () => {
    expect(splitShellWords("")).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(splitShellWords("   ")).toEqual([]);
  });

  it("handles adjacent quoted segments", () => {
    expect(splitShellWords("echo 'hello ''world'")).toEqual(["echo", "hello world"]);
  });

  it("handles empty quoted strings", () => {
    expect(splitShellWords('echo \'\' ""')).toEqual(["echo", "", ""]);
  });

  it("throws on unterminated single quote", () => {
    expect(() => splitShellWords("echo 'unterminated")).toThrow(/unterminated/i);
  });

  it("throws on unterminated double quote", () => {
    expect(() => splitShellWords('echo "unterminated')).toThrow(/unterminated/i);
  });
});
