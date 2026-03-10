import { eq } from "drizzle-orm";
import type { RadarDb } from "../index.js";
import { sources } from "../schema.js";

export interface CreateSourceInput {
  name: string;
  type: string;
  config: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateSourceInput {
  name?: string;
  type?: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export interface SourceRow {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

function toRow(raw: typeof sources.$inferSelect): SourceRow {
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    config: JSON.parse(raw.config) as Record<string, unknown>,
    enabled: raw.enabled,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export class SourceRepo {
  constructor(private db: RadarDb) {}

  create(input: CreateSourceInput): SourceRow {
    const now = Math.floor(Date.now() / 1000);
    const id = crypto.randomUUID();
    this.db
      .insert(sources)
      .values({
        id,
        name: input.name,
        type: input.type,
        config: JSON.stringify(input.config),
        enabled: input.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const row = this.db.select().from(sources).where(eq(sources.id, id)).get();
    if (!row) throw new Error("Insert failed");
    return toRow(row);
  }

  getById(id: string): SourceRow | undefined {
    const row = this.db.select().from(sources).where(eq(sources.id, id)).get();
    return row ? toRow(row) : undefined;
  }

  getByName(name: string): SourceRow | undefined {
    const row = this.db.select().from(sources).where(eq(sources.name, name)).get();
    return row ? toRow(row) : undefined;
  }

  list(): SourceRow[] {
    return this.db.select().from(sources).all().map(toRow);
  }

  update(id: string, input: UpdateSourceInput): SourceRow | undefined {
    const now = Math.floor(Date.now() / 1000);
    const values: Partial<typeof sources.$inferInsert> = { updatedAt: now };
    if (input.name !== undefined) values.name = input.name;
    if (input.type !== undefined) values.type = input.type;
    if (input.config !== undefined) values.config = JSON.stringify(input.config);
    if (input.enabled !== undefined) values.enabled = input.enabled;
    this.db.update(sources).set(values).where(eq(sources.id, id)).run();
    return this.getById(id);
  }

  delete(id: string): void {
    this.db.delete(sources).where(eq(sources.id, id)).run();
  }
}
