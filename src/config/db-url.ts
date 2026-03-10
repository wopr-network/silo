export function getDatabaseUrl(): string {
  return process.env.SILO_DB_URL?.trim() || process.env.DATABASE_URL?.trim() || "postgresql://localhost:5432/silo";
}

export const DATABASE_URL = getDatabaseUrl();
