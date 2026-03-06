import { describe, expect, it } from "vitest";
import * as mainModule from "../src/main.ts";

describe("project setup", () => {
  it("should export createDatabase, runMigrations, and bootstrap", () => {
    expect(typeof mainModule.createDatabase).toBe("function");
    expect(typeof mainModule.runMigrations).toBe("function");
    expect(typeof mainModule.bootstrap).toBe("function");
  });
});
