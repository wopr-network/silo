export type SlotState = "idle" | "claimed" | "working" | "reporting";

export interface WorkerResult {
  signal: string;
  artifacts: Record<string, unknown>;
  exitCode: number;
}

export interface Slot {
  slotId: string;
  workerId: string;
  discipline: string;
  entityId: string | null;
  state: SlotState;
  prompt: string | null;
  result: WorkerResult | null;
  flowName: string | null;
  repo: string | null;
  lastHeartbeat: number;
}
