export type ActivityType = "start" | "tool_use" | "text" | "result";

export interface ActivityRow {
  id: string;
  entityId: string;
  slotId: string;
  seq: number;
  type: ActivityType;
  data: Record<string, unknown>;
  createdAt: number;
}

export interface IEntityActivityRepo {
  /**
   * Atomically computes the next seq and inserts the row.
   * seq is managed internally — callers do not supply it.
   */
  insert(input: Omit<ActivityRow, "id" | "seq" | "createdAt">): Promise<void>;

  /**
   * Returns all activity rows for the entity in ascending seq order.
   * If `since` is provided, only rows with seq > since are returned.
   */
  getByEntity(entityId: string, since?: number): Promise<ActivityRow[]>;

  /**
   * Returns a prose summary of all prior work for injection into retry prompts.
   * Groups events by slotId (each slot = one attempt).
   * Returns empty string if no activity exists.
   */
  getSummary(entityId: string): Promise<string>;

  /** Removes all activity rows for the given entity. */
  deleteByEntity(entityId: string): Promise<void>;
}
