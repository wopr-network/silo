export interface LinearIssueState {
  type: "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled";
  name: string;
}

export interface LinearRelatedIssue {
  identifier: string;
  title: string;
  state: LinearIssueState;
}

export interface LinearRelation {
  type: "blocks" | "blocked_by" | "related" | "duplicate";
  relatedIssue: LinearRelatedIssue;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  state: LinearIssueState;
  relations: LinearRelation[];
}

export interface BlockingCheckResult {
  unblocked: boolean;
  blockers: LinearRelatedIssue[];
}

export interface LinearSearchIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: LinearIssueState;
  labels: Array<{ name: string }>;
  team?: { id: string };
}

export interface LinearWatchFilter {
  state?: string;
  labels?: string[];
  teamIds?: string[];
}
