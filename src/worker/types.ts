export type WorkerStatus = "idle" | "active" | "inactive";

export interface Worker {
  id: string;
  name: string;
  type: string;
  discipline: string | null;
  status: WorkerStatus;
  createdAt: Date;
  lastActivityAt: Date;
}
