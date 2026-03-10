/**
 * IFlowEngine — the contract between the worker run-loop and the engine.
 *
 * Replaces the HTTP boundary (SiloClient) with a direct in-process call.
 * Both SiloClient (remote) and DirectFlowEngine (local) implement this.
 */
import type { ClaimResponse, ReportResponse } from "../api/wire-types.js";

export interface FlowEngineRequestOptions {
  signal?: AbortSignal;
}

export interface IFlowEngine {
  claim(
    params: { workerId?: string; role: string; flow?: string },
    opts?: FlowEngineRequestOptions,
  ): Promise<ClaimResponse>;

  report(
    params: {
      entityId: string;
      signal: string;
      artifacts?: Record<string, unknown>;
      workerId?: string;
    },
    opts?: FlowEngineRequestOptions,
  ): Promise<ReportResponse>;
}
