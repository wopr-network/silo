import { beforeEach, describe, expect, it, vi } from "vitest";
import { LinearClient } from "./client.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockLinearResponse(
  nodes: Array<{
    id: string;
    identifier: string;
    title: string;
    description: string | null;
    state: { type: string; name: string };
    labels: { nodes: Array<{ name: string }> };
  }>,
  hasNextPage = false,
  endCursor: string | null = null,
) {
  return {
    ok: true,
    json: async () => ({
      data: {
        issues: {
          nodes,
          pageInfo: { hasNextPage, endCursor },
        },
      },
    }),
  };
}

describe("LinearClient.searchIssues", () => {
  let client: LinearClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new LinearClient({ apiKey: "test-key" });
  });

  it("sends teamIds filter in GraphQL query when provided", async () => {
    mockFetch.mockResolvedValueOnce(mockLinearResponse([]));

    await client.searchIssues({ stateName: "In Progress", teamIds: ["team-1", "team-2"] });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.variables.teamIds).toEqual(["team-1", "team-2"]);
    expect(body.query).toContain("$teamIds");
    expect(body.query).toContain("team:");
  });

  it("omits team filter when teamIds is not provided", async () => {
    mockFetch.mockResolvedValueOnce(mockLinearResponse([]));

    await client.searchIssues({ stateName: "In Progress" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.variables.teamIds).toBeUndefined();
    expect(body.query).not.toContain("$teamIds");
  });

  it("omits team filter when teamIds is empty array", async () => {
    mockFetch.mockResolvedValueOnce(mockLinearResponse([]));

    await client.searchIssues({ stateName: "In Progress", teamIds: [] });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.variables.teamIds).toBeUndefined();
    expect(body.query).not.toContain("$teamIds");
  });

  it("sends teamIds filter without stateName", async () => {
    mockFetch.mockResolvedValueOnce(mockLinearResponse([]));

    await client.searchIssues({ teamIds: ["team-1"] });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.variables.teamIds).toEqual(["team-1"]);
    expect(body.query).toContain("$teamIds");
    expect(body.query).not.toContain("$stateName");
  });

  it("sends Authorization header with Bearer prefix", async () => {
    mockFetch.mockResolvedValueOnce(mockLinearResponse([]));

    await client.searchIssues({ stateName: "In Progress" });

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer test-key");
  });
});
