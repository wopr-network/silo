import type { WorkerResult } from "../pool/types.js";

export type { WorkerResult };

export interface DispatchOpts {
  modelTier: "opus" | "sonnet" | "haiku";
  workerId: string;
  entityId: string;
  agentRole?: string | null;
  timeout?: number;
  /** Handlebars context from silo's invocation-builder — used to render agent MD templates */
  templateContext?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Nuke event shapes — mirror the SSE events emitted by the nuke container
// ---------------------------------------------------------------------------

export interface NukeSystemEvent {
  type: "system";
  subtype: string;
}

export interface NukeToolUseEvent {
  type: "tool_use";
  name: string;
  input: Record<string, unknown>;
}

export interface NukeTextEvent {
  type: "text";
  text: string;
}

export interface NukeResultEvent {
  type: "result";
  subtype: string;
  isError: boolean;
  stopReason: string | null;
  costUsd: number | null;
}

export type NukeEvent = NukeSystemEvent | NukeToolUseEvent | NukeTextEvent | NukeResultEvent;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Consumes an agent event stream. */
export interface INukeEventEmitter {
  events(): AsyncIterable<NukeEvent>;
}

/** The contract the run loop depends on for dispatching work. */
export interface INukeDispatcher {
  dispatch(prompt: string, opts: DispatchOpts): Promise<WorkerResult>;
}

/** @deprecated Use INukeDispatcher */
export type Dispatcher = INukeDispatcher;
