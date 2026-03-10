import type { ClaimResponse } from "../api/wire-types.js";

export interface ExternalClaimRequest {
  worker_id?: string;
  workerType?: string;
  discipline?: string;
  role: string;
  flow?: string;
}

export interface ExternalClaimResponse {
  worker_id: string;
  claim: ClaimResponse;
  worker_notice?: string;
}
