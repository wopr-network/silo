import type { INukeDispatcher as Dispatcher } from "../dispatcher/types.js";
import type { IFlowEngine } from "../engine/flow-engine-interface.js";
import type { Pool } from "../pool/pool.js";
import type { ThroughputTracker } from "../pool/throughput-tracker.js";
import type { IEntityActivityRepo } from "../radar-db/repos/i-entity-activity-repo.js";
import type { IWorkerRepo } from "../radar-db/types.js";

export interface SlotRole {
  discipline: string;
  count: number;
}

export interface RunLoopConfig {
  pool: Pool;
  /** Flow engine — either DirectFlowEngine (in-process) or SiloClient (HTTP). */
  engine: IFlowEngine;
  dispatcher: Dispatcher;
  activityRepo?: IEntityActivityRepo;
  workerRepo?: IWorkerRepo;
  workerType?: string;
  workerDiscipline?: string;
  /** Multi-slot role configuration. Takes precedence over `role`. */
  roles?: SlotRole[];
  /** Single-discipline shorthand — equivalent to `roles: [{ discipline, count: pool.size }]`. */
  role?: string;
  flow?: string;
  pollIntervalMs?: number;
  workerIdPrefix?: string;
  maxConcurrent?: number;
  maxConcurrentPerRepo?: number;
  stopTimeoutMs?: number;
  throughputTracker?: ThroughputTracker;
}
