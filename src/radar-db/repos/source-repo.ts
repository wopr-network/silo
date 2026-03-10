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
  constructor(
    private db: RadarDb,
    private tenantId: string = "default",
  ) {}

  async create(input: CreateSourceInput): Promise<SourceRow> {
    const now = Math.floor(Date.now() / 1000);
    const id = crypto.randomUUID();
    await this.db.insert(sources).values({
      id,
      tenantId: this.tenantId,
      name: input.name,
      type: input.type,
      config: JSON.stringify(input.config),
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    });
    const [row] = await this.db.select().from(sources).where(eq(sources.id, id));
    if (!row) throw new Error("Insert failed");
    return toRow(row);
  }

  async getById(id: string): Promise<SourceRow | undefined> {
    const [row] = await this.db.select().from(sources).where(eq(sources.id, id));
    return row ? toRow(row) : undefined;
  }

  async getByName(name: string): Promise<SourceRow | undefined> {
    const [row] = await this.db.select().from(sources).where(eq(sources.name, name));
    return row ? toRow(row) : undefined;
  }

  async list(): Promise<SourceRow[]> {
    const rows = await this.db.select().from(sources);
    return rows.map(toRow);
  }

  async update(id: string, input: UpdateSourceInput): Promise<SourceRow | undefined> {
    const now = Math.floor(Date.now() / 1000);
    const values: Partial<typeof sources.$inferInsert> = { updatedAt: now };
    if (input.name !== undefined) values.name = input.name;
    if (input.type !== undefined) values.type = input.type;
    if (input.config !== undefined) values.config = JSON.stringify(input.config);
    if (input.enabled !== undefined) values.enabled = input.enabled;
    await this.db.update(sources).set(values).where(eq(sources.id, id));
    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(sources).where(eq(sources.id, id));
  }
}
