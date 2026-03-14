import type { LinearIssue, LinearIssueState, LinearRelation, LinearSearchIssue } from "./types.js";

const LINEAR_API_URL = "https://api.linear.app/graphql";

function buildSearchQuery(filter: { stateName?: string; teamIds?: string[] }): string {
  const hasState = filter.stateName !== undefined;
  const hasTeams = filter.teamIds !== undefined && filter.teamIds.length > 0;

  const vars: string[] = ["$first: Int", "$after: String"];
  if (hasState) vars.push("$stateName: String!");
  if (hasTeams) vars.push("$teamIds: [ID!]!");

  const filters: string[] = [];
  if (hasState) filters.push("state: { name: { eq: $stateName } }");
  if (hasTeams) filters.push("team: { id: { in: $teamIds } }");

  const filterClause = filters.length > 0 ? `filter: { ${filters.join(", ")} }, ` : "";

  return `
    query SearchIssues(${vars.join(", ")}) {
      issues(${filterClause}first: $first, after: $after) {
        nodes {
          id
          identifier
          title
          description
          state { type name }
          labels { nodes { name } }
          team { id }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;
}

const ISSUE_WITH_RELATIONS_QUERY = `
  query IssueWithRelations($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      state { type name }
      relations {
        nodes {
          type
          relatedIssue {
            identifier
            title
            state { type name }
          }
        }
      }
      inverseRelations {
        nodes {
          type
          issue {
            identifier
            title
            state { type name }
          }
        }
      }
    }
  }
`;

export interface LinearClientConfig {
  apiKey: string;
}

interface SearchIssuesResponse {
  data?: {
    issues: {
      nodes: Array<{
        id: string;
        identifier: string;
        title: string;
        description: string | null;
        state: { type: string; name: string };
        labels: { nodes: Array<{ name: string }> };
        team: { id: string };
      }>;
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
    };
  };
  errors?: Array<{ message: string }>;
}

interface GraphQLResponse {
  data?: {
    issue: {
      id: string;
      identifier: string;
      title: string;
      state: { type: string; name: string };
      relations: {
        nodes: Array<{
          type: string;
          relatedIssue: {
            identifier: string;
            title: string;
            state: { type: string; name: string };
          };
        }>;
      };
      inverseRelations: {
        nodes: Array<{
          type: string;
          issue: {
            identifier: string;
            title: string;
            state: { type: string; name: string };
          };
        }>;
      };
    };
  };
  errors?: Array<{ message: string }>;
}

export class LinearClient {
  private apiKey: string;

  constructor(config: LinearClientConfig) {
    this.apiKey = config.apiKey;
  }

  async searchIssues(filter: { stateName?: string; teamIds?: string[]; first?: number }): Promise<LinearSearchIssue[]> {
    const pageSize = filter.first ?? 50;
    const allIssues: LinearSearchIssue[] = [];
    let cursor: string | null = null;
    const query = buildSearchQuery(filter);

    do {
      const variables: Record<string, unknown> = { first: pageSize, after: cursor ?? undefined };
      if (filter.stateName !== undefined) variables.stateName = filter.stateName;
      if (filter.teamIds !== undefined && filter.teamIds.length > 0) variables.teamIds = filter.teamIds;

      const res = await fetch(LINEAR_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
      });

      if (!res.ok) {
        throw new Error(`Linear API error: ${res.status}`);
      }

      const json = (await res.json()) as SearchIssuesResponse;

      if (json.errors?.length) {
        throw new Error(json.errors[0].message);
      }

      if (!json.data) {
        throw new Error("Linear API returned no data");
      }

      const page = json.data.issues;
      for (const n of page.nodes) {
        allIssues.push({
          id: n.id,
          identifier: n.identifier,
          title: n.title,
          description: n.description,
          state: n.state as LinearIssueState,
          labels: n.labels.nodes,
          team: n.team,
        });
      }

      cursor = page.pageInfo.hasNextPage ? (page.pageInfo.endCursor ?? null) : null;
    } while (cursor !== null);

    return allIssues;
  }

  async getIssueWithRelations(issueId: string): Promise<LinearIssue> {
    const res = await fetch(LINEAR_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: ISSUE_WITH_RELATIONS_QUERY, variables: { id: issueId } }),
    });

    if (!res.ok) {
      throw new Error(`Linear API error: ${res.status}`);
    }

    const json = (await res.json()) as GraphQLResponse;

    if (json.errors?.length) {
      throw new Error(json.errors[0].message);
    }

    if (!json.data) {
      throw new Error("Linear API returned no data");
    }

    const issue = json.data.issue;

    if (!issue) {
      throw new Error(`Issue ${issueId} not found`);
    }

    const directRelations: LinearRelation[] = issue.relations.nodes.map((n) => ({
      type: n.type as LinearRelation["type"],
      relatedIssue: {
        identifier: n.relatedIssue.identifier,
        title: n.relatedIssue.title,
        state: n.relatedIssue.state as LinearIssue["state"],
      },
    }));

    // inverseRelations where type="blocks" mean the related issue blocks this one,
    // which is semantically equivalent to this issue having a "blocked_by" relation.
    const inverseRelations: LinearRelation[] = issue.inverseRelations.nodes
      .filter((n) => n.type === "blocks")
      .map((n) => ({
        type: "blocked_by" as LinearRelation["type"],
        relatedIssue: {
          identifier: n.issue.identifier,
          title: n.issue.title,
          state: n.issue.state as LinearIssue["state"],
        },
      }));

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      state: issue.state as LinearIssue["state"],
      relations: [...directRelations, ...inverseRelations],
    };
  }
}
