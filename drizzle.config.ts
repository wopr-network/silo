import { defineConfig } from "drizzle-kit";
import { DB_PATH } from "./src/config/db-path.js";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/repositories/drizzle/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: DB_PATH,
  },
});
