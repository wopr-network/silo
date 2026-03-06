import { LinearClient } from "@linear/sdk";
import type { IIssueTrackerAdapter } from "./interfaces.js";

interface LinearAdapterConfig {
  apiKey: string;
  teamId?: string;
}

interface LinearLabel {
  name: string;
}

interface LinearLabelsConnection {
  nodes: LinearLabel[];
}

interface LinearNamedEntity {
  name: string;
}

interface LinearIssuePayload {
  id: string;
  identifier: string;
  title: string;
  description: string | undefined | null;
  priority: number;
  url: string;
  state: Promise<LinearNamedEntity | null | undefined>;
  assignee: Promise<LinearNamedEntity | null | undefined>;
  project: Promise<LinearNamedEntity | null | undefined>;
  labels: () => Promise<LinearLabelsConnection>;
}

interface LinearCreateIssueResult {
  issue: { id: string } | null | undefined;
  success: boolean;
}

interface LinearIssuesResult {
  nodes: LinearIssuePayload[];
}

interface LinearWorkflowState {
  id: string;
  name: string;
}

interface LinearWorkflowStatesResult {
  nodes: LinearWorkflowState[];
}

export class LinearAdapter implements IIssueTrackerAdapter {
  private client: LinearClient;
  private teamId: string | undefined;

  constructor(config: LinearAdapterConfig) {
    this.client = new LinearClient({ apiKey: config.apiKey });
    this.teamId = config.teamId;
  }

  async get(id: string): Promise<Record<string, unknown>> {
    const issue = (await this.client.issue(id)) as unknown as LinearIssuePayload | null | undefined;
    if (!issue) {
      throw new Error(`Issue not found: ${id}`);
    }
    return this.normalize(issue);
  }

  async list(filter: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const linearFilter: Record<string, unknown> = {};

    if (filter.state !== undefined) {
      linearFilter.state = { name: { eq: filter.state } };
    }
    if (filter.priority !== undefined) {
      linearFilter.priority = { eq: filter.priority };
    }
    if (filter.project !== undefined) {
      linearFilter.project = { name: { eq: filter.project } };
    }
    if (filter.labels !== undefined) {
      linearFilter.labels = { some: { name: { in: filter.labels } } };
    }
    if (this.teamId) {
      linearFilter.team = { id: { eq: this.teamId } };
    }

    const result = (await this.client.issues({ filter: linearFilter as never })) as unknown as LinearIssuesResult;
    return Promise.all(result.nodes.map((issue) => this.normalize(issue)));
  }

  async create(data: Record<string, unknown>): Promise<{ id: string }> {
    if (!this.teamId) {
      throw new Error("teamId is required to create issues");
    }
    const payload = Object.assign({}, data, { teamId: this.teamId });
    const result = (await this.client.createIssue(payload as never)) as unknown as LinearCreateIssueResult;
    const issue = result.issue;
    if (!issue) {
      throw new Error("Failed to create issue: no issue returned");
    }
    return { id: issue.id };
  }

  async update(id: string, data: Record<string, unknown>): Promise<void> {
    await this.client.updateIssue(id, data as never);
  }

  async transition(id: string, state: string): Promise<void> {
    const filter: Record<string, unknown> = { name: { eq: state } };
    if (this.teamId) {
      filter.team = { id: { eq: this.teamId } };
    }

    const states = (await this.client.workflowStates({
      filter: filter as never,
    })) as unknown as LinearWorkflowStatesResult;
    const target = states.nodes[0];
    if (!target) {
      throw new Error(`Workflow state "${state}" not found`);
    }
    await this.client.updateIssue(id, { stateId: target.id });
  }

  async addComment(id: string, content: string): Promise<void> {
    await this.client.createComment({ issueId: id, body: content });
  }

  private async normalize(issue: LinearIssuePayload): Promise<Record<string, unknown>> {
    const [state, assignee, project] = await Promise.all([issue.state, issue.assignee, issue.project]);
    const labelsConnection = await issue.labels();

    return {
      id: issue.id,
      key: issue.identifier,
      title: issue.title,
      description: issue.description ?? undefined,
      state: state?.name,
      priority: issue.priority,
      labels: labelsConnection.nodes.map((l) => l.name),
      assignee: assignee?.name,
      url: issue.url,
      project: project?.name,
    };
  }
}
