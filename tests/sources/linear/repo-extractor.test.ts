import { describe, expect, it } from "vitest";
import {
  extractRepoFromDescription,
  extractReposFromDescription,
} from "../../../src/sources/linear/repo-extractor.js";

describe("extractReposFromDescription", () => {
  it("returns empty array when description is null", () => {
    expect(extractReposFromDescription(null)).toEqual([]);
  });

  it("returns empty array when no Repo line exists", () => {
    expect(extractReposFromDescription("Just a description")).toEqual([]);
  });

  it("parses a single repo", () => {
    const desc = "**Repo:** wopr-network/wopr-platform\n\nSome description";
    expect(extractReposFromDescription(desc)).toEqual(["wopr-network/wopr-platform"]);
  });

  it("parses multiple repos separated by +", () => {
    const desc = "**Repo:** wopr-network/wopr-platform + wopr-network/platform-core\n\nDetails";
    expect(extractReposFromDescription(desc)).toEqual([
      "wopr-network/wopr-platform",
      "wopr-network/platform-core",
    ]);
  });

  it("parses three repos", () => {
    const desc = "**Repo:** wopr-network/a + wopr-network/b + wopr-network/c";
    expect(extractReposFromDescription(desc)).toEqual(["wopr-network/a", "wopr-network/b", "wopr-network/c"]);
  });

  it("trims whitespace around repo names", () => {
    const desc = "**Repo:**   wopr-network/foo  +  wopr-network/bar  ";
    expect(extractReposFromDescription(desc)).toEqual(["wopr-network/foo", "wopr-network/bar"]);
  });
});

describe("extractRepoFromDescription (deprecated wrapper)", () => {
  it("returns null when description is null", () => {
    expect(extractRepoFromDescription(null)).toBeNull();
  });

  it("returns first repo from multi-repo description", () => {
    const desc = "**Repo:** wopr-network/a + wopr-network/b";
    expect(extractRepoFromDescription(desc)).toBe("wopr-network/a");
  });

  it("returns single repo as before", () => {
    const desc = "**Repo:** wopr-network/wopr-platform";
    expect(extractRepoFromDescription(desc)).toBe("wopr-network/wopr-platform");
  });
});
