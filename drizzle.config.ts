import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/repositories/drizzle/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // NOTE: This path must match DB_PATH in src/config/db-path.ts.
    // drizzle-kit runs in a CJS context and cannot import ESM source files directly.
    url: "./silo.db",
  },
});
