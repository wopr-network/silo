import type { ClaimResponse, CreateEntityResponse, ReportResponse } from "../api/wire-types.js";
import type { FlowEngineRequestOptions, IFlowEngine } from "../engine/flow-engine-interface.js";

export interface DefconClientConfig {
  url: string;
  workerToken?: string;
}

export type DefconRequestOptions = FlowEngineRequestOptions;

export class DefconClient implements IFlowEngine {
  private url: string;
  private authHeader: Record<string, string>;

  constructor(config: DefconClientConfig) {
    this.url = config.url;
    this.authHeader = config.workerToken ? { Authorization: `Bearer ${config.workerToken}` } : {};
  }

  async claim(
    params: { workerId?: string; role: string; flow?: string },
    opts?: DefconRequestOptions,
  ): Promise<ClaimResponse> {
    // workerId is best-effort affinity — REST endpoints don't carry it
    const endpoint = params.flow
      ? `${this.url}/api/flows/${encodeURIComponent(params.flow)}/claim`
      : `${this.url}/api/claim`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeader },
      body: JSON.stringify({ role: params.role }),
      signal: opts?.signal,
    });
    if (!res.ok) throw new Error(`flow.claim failed: ${res.status}`);
    return res.json() as Promise<ClaimResponse>;
  }

  async createEntity(params: { flowName: string; payload?: Record<string, unknown> }): Promise<CreateEntityResponse> {
    const signal = AbortSignal.timeout(30_000);
    const res = await fetch(`${this.url}/api/entities`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeader },
      // defcon expects `flow` (not `flowName`)
      body: JSON.stringify({ flow: params.flowName, ...(params.payload ? { payload: params.payload } : {}) }),
      signal,
    });
    if (!res.ok) throw new Error(`entity create failed: ${res.status}`);
    return res.json() as Promise<CreateEntityResponse>;
  }

  async report(
    params: {
      entityId: string;
      signal: string;
      artifacts?: Record<string, unknown>;
      workerId?: string;
    },
    opts?: DefconRequestOptions,
  ): Promise<ReportResponse> {
    // flow.report blocks — no timeout applied
    const body: Record<string, unknown> = { signal: params.signal };
    if (params.artifacts) body.artifacts = params.artifacts;
    if (params.workerId) body.worker_id = params.workerId;
    const res = await fetch(`${this.url}/api/entities/${encodeURIComponent(params.entityId)}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeader },
      body: JSON.stringify(body),
      signal: opts?.signal,
    });
    if (!res.ok) throw new Error(`flow.report failed: ${res.status}`);
    return res.json() as Promise<ReportResponse>;
  }
}
