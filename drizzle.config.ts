import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/repositories/drizzle/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.SILO_DB_URL ?? process.env.DATABASE_URL ?? "postgresql://localhost:5432/silo",
  },
});
