import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30000,
    exclude: ["dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [
        "src/config/index.ts",
        "src/engine/index.ts",
        "src/execution/index.ts",
        "src/repositories/drizzle/index.ts",
        "src/repositories/interfaces.ts",
        "src/engine/event-types.ts",
      ],
      reporter: ["text", "json-summary"],
      reportOnFailure: true,
    },
  },
});
