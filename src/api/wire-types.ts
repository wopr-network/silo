/**
 * Wire types for defcon's REST and MCP APIs.
 * Exported for consumers (e.g. radar) to import instead of duplicating.
 */

export type ClaimResponse =
  | {
      next_action: "check_back";
      retry_after_ms: number;
      message: string;
    }
  | {
      entity_id: string;
      invocation_id: string;
      flow: string | null;
      state: string;
      refs: Record<string, unknown> | null;
      artifacts: Record<string, unknown> | null;
    };

export type ReportResponse =
  | {
      next_action: "continue";
      new_state: string;
      gates_passed?: string[];
      prompt: string | null;
      context: Record<string, unknown> | null;
    }
  | {
      next_action: "waiting";
      new_state: null;
      gated: true;
      gate_output: string;
      gateName: string;
      failure_prompt: string | null;
    }
  | {
      next_action: "check_back";
      message: string;
      retry_after_ms: number;
      timeout_prompt?: string;
    }
  | {
      next_action: "completed";
      new_state: string;
      gates_passed?: string[];
      prompt: null;
      context: null;
    };

export interface CreateEntityResponse {
  id: string;
}
