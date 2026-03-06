import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/repositories/drizzle/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: "./agentic-flow.db",
  },
});
