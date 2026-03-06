// Adapter interfaces — I*Adapter contracts

/** Union of all engine event types. */
export type EngineEventType =
  | "entity.created"
  | "entity.transitioned"
  | "entity.claimed"
  | "entity.released"
  | "invocation.created"
  | "invocation.claimed"
  | "invocation.completed"
  | "invocation.failed"
  | "invocation.expired"
  | "gate.passed"
  | "gate.failed"
  | "flow.spawned";

/** Event emitted by the engine during state-machine operations. */
export interface EngineEvent {
  type: EngineEventType;
  entityId?: string;
  flowId?: string;
  payload: Record<string, unknown>;
  emittedAt: Date;
}

/** Adapter for issue-tracker systems (Linear, Jira, etc.). */
export interface IIssueTrackerAdapter {
  /** Get an issue by its tracker-native ID. */
  get(id: string): Promise<Record<string, unknown>>;

  /** List issues matching a filter. */
  list(filter: Record<string, unknown>): Promise<Record<string, unknown>[]>;

  /** Create a new issue. Returns the tracker-native ID. */
  create(data: Record<string, unknown>): Promise<{ id: string }>;

  /** Update fields on an existing issue. */
  update(id: string, data: Record<string, unknown>): Promise<void>;

  /** Transition an issue to a new status. */
  transition(id: string, state: string): Promise<void>;

  /** Add a comment to an issue. */
  addComment(id: string, content: string): Promise<void>;
}

/** Adapter for code-hosting platforms (GitHub, GitLab, etc.). */
export interface ICodeHostAdapter {
  /** Get pull-request metadata. */
  getPR(repo: string, number: number): Promise<Record<string, unknown>>;

  /** Get the unified diff for a pull request. */
  getDiff(repo: string, number: number): Promise<string>;

  /** Get CI check statuses for a pull request. */
  getChecks(repo: string, number: number): Promise<{ name: string; status: string; conclusion?: string }[]>;

  /** Create a new pull request. */
  createPR(repo: string, data: Record<string, unknown>): Promise<{ number: number; url: string }>;

  /** Merge a pull request with the given strategy (merge, squash, rebase). */
  mergePR(repo: string, number: number, strategy: string): Promise<void>;

  /** Create a git worktree for isolated work. Returns the worktree path. */
  createWorktree(repo: string, branch: string, path: string): Promise<string>;

  /** Remove a git worktree. */
  removeWorktree(path: string): Promise<void>;
}

/** Adapter for AI model providers (Anthropic, OpenAI, etc.). */
export interface IAIProviderAdapter {
  /** Send a prompt to an AI model and return the response content. */
  invoke(prompt: string, config: { model: string }): Promise<{ content: string }>;
}

/** Adapter for broadcasting engine events to external systems. */
export interface IEventBusAdapter {
  /** Emit an engine event to subscribed listeners. */
  emit(event: EngineEvent): Promise<void>;
}
