import { createMcpServer } from "../../src/execution/mcp-server.js";
import type { McpServerDeps } from "../../src/execution/mcp-server.js";
import { Engine } from "../../src/engine/engine.js";
import type {
  Entity,
  Flow,
  Invocation,
  IEntityRepository,
  IEventRepository,
  IFlowRepository,
  IGateRepository,
  IInvocationRepository,
  ITransitionLogRepository,
} from "../../src/repositories/interfaces.js";

// ─── Mock factories ───

export function mockEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "ent-1",
    flowId: "flow-1",
    state: "draft",
    refs: null,
    artifacts: null,
    claimedBy: null,
    claimedAt: null,
    flowVersion: 1,
    priority: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function mockInvocation(overrides: Partial<Invocation> = {}): Invocation {
  return {
    id: "inv-1",
    entityId: "ent-1",
    stage: "draft",
    mode: "passive",
    prompt: "Implement the feature",
    context: { repo: "wopr" },
    claimedBy: null,
    claimedAt: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    signal: null,
    artifacts: null,
    error: null,
    ttlMs: 1800000,
    ...overrides,
  };
}

export function mockFlow(overrides: Partial<Flow> = {}): Flow {
  return {
    id: "flow-1",
    name: "test-flow",
    description: null,
    entitySchema: null,
    initialState: "draft",
    maxConcurrent: 0,
    maxConcurrentPerRepo: 0,
    version: 1,
    createdBy: null,
    discipline: null,
    createdAt: null,
    updatedAt: null,
    states: [
      {
        id: "s1",
        flowId: "flow-1",
        name: "draft",
        modelTier: null,
        mode: "passive",
        promptTemplate: "Do the work",
        constraints: null,
      },
      {
        id: "s2",
        flowId: "flow-1",
        name: "review",
        modelTier: null,
        mode: "passive",
        promptTemplate: "Review the work",
        constraints: null,
      },
      {
        id: "s3",
        flowId: "flow-1",
        name: "done",
        modelTier: null,
        mode: "passive",
        promptTemplate: null,
        constraints: null,
      },
    ],
    transitions: [
      {
        id: "t1",
        flowId: "flow-1",
        fromState: "draft",
        toState: "review",
        trigger: "complete",
        gateId: null,
        condition: null,
        priority: 0,
        spawnFlow: null,
        spawnTemplate: null,
        createdAt: null,
      },
      {
        id: "t2",
        flowId: "flow-1",
        fromState: "review",
        toState: "done",
        trigger: "approve",
        gateId: null,
        condition: null,
        priority: 0,
        spawnFlow: null,
        spawnTemplate: null,
        createdAt: null,
      },
    ],
    ...overrides,
  };
}

export function createMockDeps(): McpServerDeps {
  const entities: IEntityRepository = {
    create: async () => mockEntity(),
    get: async (id) => (id === "ent-1" ? mockEntity() : null),
    findByFlowAndState: async () => [mockEntity()],
    hasAnyInFlowAndState: async () => true,
    transition: async (_id, toState) => mockEntity({ state: toState }),
    updateArtifacts: async () => {},
    claim: async () => mockEntity({ claimedBy: "agent-1" }),
    claimById: async (id) => mockEntity({ id, claimedBy: "agent-1" }),
    reapExpired: async () => [],
    release: async () => {},
    setAffinity: async () => {},
    clearExpiredAffinity: async () => [],
    appendSpawnedChild: async () => {},
  };

  const flows: IFlowRepository = {
    create: async () => mockFlow(),
    get: async (id) => (id === "flow-1" ? mockFlow() : null),
    getByName: async (name) => (name === "test-flow" ? mockFlow() : null),
    list: async () => [mockFlow()],
    update: async () => mockFlow(),
    addState: async () => mockFlow().states[0],
    updateState: async () => mockFlow().states[0],
    addTransition: async () => mockFlow().transitions[0],
    updateTransition: async () => mockFlow().transitions[0],
    getAtVersion: async () => mockFlow(),
    snapshot: async () => ({
      id: "fv-1",
      flowId: "flow-1",
      version: 1,
      snapshot: {},
      changedBy: null,
      changeReason: null,
      createdAt: null,
    }),
    restore: async () => {},
    listAll: async () => [mockFlow()],
  };

  const invocations: IInvocationRepository = {
    create: async () => mockInvocation(),
    get: async () => mockInvocation(),
    claim: async (id) =>
      mockInvocation({ id, claimedBy: "coder", claimedAt: new Date() }),
    complete: async (id, signal, artifacts) =>
      mockInvocation({
        id,
        signal,
        artifacts: artifacts ?? null,
        completedAt: new Date(),
      }),
    fail: async (id, error) => mockInvocation({ id, error, failedAt: new Date() }),
    findByEntity: async () => [
      mockInvocation({ claimedBy: "coder", claimedAt: new Date() }),
    ],
    findUnclaimed: async () => [mockInvocation()],
    findUnclaimedWithAffinity: async () => [],
    findUnclaimedByFlow: async () => [mockInvocation()],
    findByFlow: async () => [],
    findUnclaimedActive: async () => [],
    reapExpired: async () => [],
    countActiveByFlow: async () => 0,
    countPendingByFlow: async () => 0,
  };

  const gates: IGateRepository = {
    create: async () => ({
      id: "g-1",
      name: "lint",
      type: "command",
      command: "pnpm lint",
      functionRef: null,
      apiConfig: null,
      timeoutMs: 30000,
    }),
    get: async () => null,
    getByName: async () => null,
    listAll: async () => [],
    record: async (entityId, gateId, passed, output) => ({
      id: "gr-1",
      entityId,
      gateId,
      passed,
      output,
      evaluatedAt: new Date(),
    }),
    resultsFor: async () => [],
  };

  const transitions: ITransitionLogRepository = {
    record: async (log) => ({ id: "tl-1", ...log }),
    historyFor: async () => [],
  };

  const eventRepo: IEventRepository = {
    emitDefinitionChanged: async () => {},
  };

  const noopEventEmitter = { emit: async () => {} };

  const engine = new Engine({
    entityRepo: entities,
    flowRepo: flows,
    invocationRepo: invocations,
    gateRepo: gates,
    transitionLogRepo: transitions,
    adapters: new Map(),
    eventEmitter: noopEventEmitter,
  });

  return { entities, flows, invocations, gates, transitions, eventRepo, engine };
}

// ─── MCP transport helpers ───

/** Connect an in-memory MCP client+server pair and call a single tool. */
export async function callTool(
  deps: McpServerDeps,
  toolName: string,
  args: Record<string, unknown>,
) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import(
    "@modelcontextprotocol/sdk/inMemory.js"
  );

  const server = createMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: "test-client", version: "0.1.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  try {
    return await client.callTool({ name: toolName, arguments: args });
  } finally {
    await client.close();
    await server.close();
  }
}

/** Connect an in-memory MCP client+server pair and list all tools. */
export async function listTools(deps: McpServerDeps) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import(
    "@modelcontextprotocol/sdk/inMemory.js"
  );

  const server = createMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: "test-client", version: "0.1.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  try {
    return await client.listTools();
  } finally {
    await client.close();
    await server.close();
  }
}

/** Parse the first text content entry from a tool result. */
export function parseResult(result: { content: Array<{ text: string }> }) {
  if (result.content.length === 0) {
    throw new Error("parseResult: tool result content array is empty");
  }
  return JSON.parse(result.content[0].text);
}
