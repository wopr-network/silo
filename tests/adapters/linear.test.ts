import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IIssueTrackerAdapter } from "../../src/adapters/interfaces.js";

interface MockLinearClient {
  issue: ReturnType<typeof vi.fn>;
  issues: ReturnType<typeof vi.fn>;
  createIssue: ReturnType<typeof vi.fn>;
  updateIssue: ReturnType<typeof vi.fn>;
  workflowStates: ReturnType<typeof vi.fn>;
  createComment: ReturnType<typeof vi.fn>;
}

const mockClient: MockLinearClient = {
  issue: vi.fn(),
  issues: vi.fn(),
  createIssue: vi.fn(),
  updateIssue: vi.fn(),
  workflowStates: vi.fn(),
  createComment: vi.fn(),
};

vi.mock("@linear/sdk", () => {
  return {
    LinearClient: class {
      issue = mockClient.issue;
      issues = mockClient.issues;
      createIssue = mockClient.createIssue;
      updateIssue = mockClient.updateIssue;
      workflowStates = mockClient.workflowStates;
      createComment = mockClient.createComment;
    },
  };
});

describe("LinearAdapter", () => {
  let adapter: IIssueTrackerAdapter;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { LinearAdapter } = await import("../../src/adapters/linear.js");
    adapter = new LinearAdapter({ apiKey: "test-key", teamId: "team-1" });
  });

  describe("get", () => {
    it("should fetch and normalize an issue by ID", async () => {
      mockClient.issue.mockResolvedValue({
        id: "issue-1",
        identifier: "WOP-81",
        title: "Test issue",
        description: "A description",
        priority: 2,
        url: "https://linear.app/wopr/issue/WOP-81",
        state: Promise.resolve({ name: "In Progress" }),
        assignee: Promise.resolve({ name: "Alice" }),
        labels: vi.fn().mockResolvedValue({ nodes: [{ name: "bug" }] }),
        project: Promise.resolve({ name: "WOPR" }),
      });

      const result = await adapter.get("issue-1");

      expect(mockClient.issue).toHaveBeenCalledWith("issue-1");
      expect(result).toEqual({
        id: "issue-1",
        key: "WOP-81",
        title: "Test issue",
        description: "A description",
        state: "In Progress",
        priority: 2,
        labels: ["bug"],
        assignee: "Alice",
        url: "https://linear.app/wopr/issue/WOP-81",
        project: "WOPR",
      });
    });

    it("should throw when issue not found", async () => {
      mockClient.issue.mockResolvedValue(null);

      await expect(adapter.get("missing-id")).rejects.toThrow("Issue not found: missing-id");
    });

    it("should handle null optional fields", async () => {
      mockClient.issue.mockResolvedValue({
        id: "issue-2",
        identifier: "WOP-82",
        title: "Minimal issue",
        description: undefined,
        priority: 0,
        url: "https://linear.app/wopr/issue/WOP-82",
        state: Promise.resolve(null),
        assignee: Promise.resolve(null),
        labels: vi.fn().mockResolvedValue({ nodes: [] }),
        project: Promise.resolve(null),
      });

      const result = await adapter.get("issue-2");

      expect(result).toEqual({
        id: "issue-2",
        key: "WOP-82",
        title: "Minimal issue",
        description: undefined,
        state: undefined,
        priority: 0,
        labels: [],
        assignee: undefined,
        url: "https://linear.app/wopr/issue/WOP-82",
        project: undefined,
      });
    });
  });

  describe("list", () => {
    it("should list issues with state filter", async () => {
      const mockIssue = {
        id: "issue-3",
        identifier: "WOP-83",
        title: "Listed issue",
        description: null,
        priority: 1,
        url: "https://linear.app/wopr/issue/WOP-83",
        state: Promise.resolve({ name: "Todo" }),
        assignee: Promise.resolve(null),
        labels: vi.fn().mockResolvedValue({ nodes: [] }),
        project: Promise.resolve(null),
      };
      mockClient.issues.mockResolvedValue({ nodes: [mockIssue] });

      const results = await adapter.list({ state: "Todo" });

      expect(mockClient.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          team: { id: { eq: "team-1" } },
        },
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ key: "WOP-83", state: "Todo" });
    });

    it("should list issues with priority filter", async () => {
      mockClient.issues.mockResolvedValue({ nodes: [] });

      await adapter.list({ priority: 1 });

      expect(mockClient.issues).toHaveBeenCalledWith({
        filter: {
          priority: { eq: 1 },
          team: { id: { eq: "team-1" } },
        },
      });
    });

    it("should list issues with labels filter", async () => {
      mockClient.issues.mockResolvedValue({ nodes: [] });

      await adapter.list({ labels: ["bug", "urgent"] });

      expect(mockClient.issues).toHaveBeenCalledWith({
        filter: {
          labels: { some: { name: { in: ["bug", "urgent"] } } },
          team: { id: { eq: "team-1" } },
        },
      });
    });

    it("should list issues with project filter", async () => {
      mockClient.issues.mockResolvedValue({ nodes: [] });

      await adapter.list({ project: "WOPR" });

      expect(mockClient.issues).toHaveBeenCalledWith({
        filter: {
          project: { name: { eq: "WOPR" } },
          team: { id: { eq: "team-1" } },
        },
      });
    });

    it("should omit team filter when teamId not configured", async () => {
      const { LinearAdapter } = await import("../../src/adapters/linear.js");
      const noTeamAdapter = new LinearAdapter({ apiKey: "test-key" });
      mockClient.issues.mockResolvedValue({ nodes: [] });

      await noTeamAdapter.list({ state: "Done" });

      expect(mockClient.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Done" } },
        },
      });
    });
  });

  describe("create", () => {
    it("should create an issue and return id", async () => {
      mockClient.createIssue.mockResolvedValue({
        issue: { id: "new-issue-1" },
        success: true,
      });

      const result = await adapter.create({ title: "New issue", description: "Details" });

      expect(mockClient.createIssue).toHaveBeenCalledWith({
        title: "New issue",
        description: "Details",
        teamId: "team-1",
      });
      expect(result).toEqual({ id: "new-issue-1" });
    });

    it("should throw when creating without teamId configured", async () => {
      const { LinearAdapter } = await import("../../src/adapters/linear.js");
      const noTeamAdapter = new LinearAdapter({ apiKey: "test-key" });

      await expect(noTeamAdapter.create({ title: "Fail" })).rejects.toThrow("teamId is required to create issues");
    });
  });

  describe("update", () => {
    it("should update issue fields", async () => {
      mockClient.updateIssue.mockResolvedValue({ success: true });

      await adapter.update("issue-1", { title: "Updated title", priority: 3 });

      expect(mockClient.updateIssue).toHaveBeenCalledWith("issue-1", {
        title: "Updated title",
        priority: 3,
      });
    });
  });

  describe("transition", () => {
    it("should resolve state name to stateId and update", async () => {
      mockClient.workflowStates.mockResolvedValue({
        nodes: [{ id: "state-done-id", name: "Done" }],
      });
      mockClient.updateIssue.mockResolvedValue({ success: true });

      await adapter.transition("issue-1", "Done");

      expect(mockClient.workflowStates).toHaveBeenCalledWith({
        filter: { name: { eq: "Done" }, team: { id: { eq: "team-1" } } },
      });
      expect(mockClient.updateIssue).toHaveBeenCalledWith("issue-1", {
        stateId: "state-done-id",
      });
    });

    it("should throw when state name not found", async () => {
      mockClient.workflowStates.mockResolvedValue({ nodes: [] });

      await expect(adapter.transition("issue-1", "Nonexistent")).rejects.toThrow(
        'Workflow state "Nonexistent" not found',
      );
    });

    it("should omit team filter in state lookup when no teamId", async () => {
      const { LinearAdapter } = await import("../../src/adapters/linear.js");
      const noTeamAdapter = new LinearAdapter({ apiKey: "test-key" });
      mockClient.workflowStates.mockResolvedValue({
        nodes: [{ id: "state-id", name: "Done" }],
      });
      mockClient.updateIssue.mockResolvedValue({ success: true });

      await noTeamAdapter.transition("issue-1", "Done");

      expect(mockClient.workflowStates).toHaveBeenCalledWith({
        filter: { name: { eq: "Done" } },
      });
    });
  });

  describe("addComment", () => {
    it("should create a comment on an issue", async () => {
      mockClient.createComment.mockResolvedValue({ success: true });

      await adapter.addComment("issue-1", "This is a comment");

      expect(mockClient.createComment).toHaveBeenCalledWith({
        issueId: "issue-1",
        body: "This is a comment",
      });
    });
  });

  describe("type conformance", () => {
    it("should satisfy IIssueTrackerAdapter", () => {
      const _check: IIssueTrackerAdapter = adapter;
      expect(_check).toBeDefined();
    });
  });
});
