// MCP server — passive mode (flow.claim, flow.report, query.*)
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Engine } from "../engine/engine.js";
import type {
  IEntityRepository,
  IEventRepository,
  IFlowRepository,
  IGateRepository,
  IIntegrationRepository,
  IInvocationRepository,
  ITransitionLogRepository,
} from "../repositories/interfaces.js";
import {
  AdminFlowCreateSchema,
  AdminFlowRestoreSchema,
  AdminFlowSnapshotSchema,
  AdminFlowUpdateSchema,
  AdminGateAttachSchema,
  AdminGateCreateSchema,
  AdminIntegrationSetSchema,
  AdminStateCreateSchema,
  AdminStateUpdateSchema,
  AdminTransitionCreateSchema,
  AdminTransitionUpdateSchema,
} from "./admin-schemas.js";

export interface McpServerDeps {
  entities: IEntityRepository;
  flows: IFlowRepository;
  invocations: IInvocationRepository;
  gates: IGateRepository;
  transitions: ITransitionLogRepository;
  eventRepo: IEventRepository;
  integrationRepo: IIntegrationRepository;
  engine?: Engine;
}

const TOOL_DEFINITIONS = [
  {
    name: "flow.claim",
    description:
      "Claim the next available work item for a given agent role. Returns entity_id, invocation_id, prompt, and context — or null if no work is available.",
    inputSchema: {
      type: "object" as const,
      properties: {
        role: { type: "string", description: "Agent role to claim work for" },
        flow: { type: "string", description: "Optional flow name to filter by" },
      },
      required: ["role"],
    },
  },
  {
    name: "flow.get_prompt",
    description: "Get the current prompt and context for an entity. Useful if agent needs to re-read its assignment.",
    inputSchema: {
      type: "object" as const,
      properties: {
        entity_id: { type: "string", description: "Entity ID" },
      },
      required: ["entity_id"],
    },
  },
  {
    name: "flow.report",
    description: "Report completion of work on an entity. Triggers state transition and gate evaluation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        entity_id: { type: "string", description: "Entity ID" },
        signal: {
          type: "string",
          description: "Completion signal (matches transition trigger)",
        },
        artifacts: { type: "object", description: "Optional artifacts to attach" },
      },
      required: ["entity_id", "signal"],
    },
  },
  {
    name: "flow.fail",
    description: "Report failure on an entity. Marks the current invocation as failed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        entity_id: { type: "string", description: "Entity ID" },
        error: { type: "string", description: "Error message" },
      },
      required: ["entity_id", "error"],
    },
  },
  {
    name: "query.entity",
    description: "Get full entity details including history.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Entity ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "query.entities",
    description: "Search entities by flow and state.",
    inputSchema: {
      type: "object" as const,
      properties: {
        flow: { type: "string", description: "Flow name to filter by" },
        state: { type: "string", description: "State to filter by" },
        limit: { type: "number", description: "Max results (default 50)" },
      },
      required: ["flow", "state"],
    },
  },
  {
    name: "query.invocations",
    description: "Get all invocations for an entity.",
    inputSchema: {
      type: "object" as const,
      properties: {
        entity_id: { type: "string", description: "Entity ID" },
      },
      required: ["entity_id"],
    },
  },
  {
    name: "query.flow",
    description: "Get a flow definition with its states and transitions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Flow name" },
      },
      required: ["name"],
    },
  },
  // ─── Admin Tools ───
  {
    name: "admin.flow.create",
    description: "Create a new flow definition with its initial states.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Unique flow name" },
        initialState: { type: "string", description: "Name of the initial state (must be in states array)" },
        description: { type: "string", description: "Flow description" },
        entitySchema: { type: "object", description: "JSON schema for entity data" },
        maxConcurrent: { type: "number", description: "Max concurrent entities (0=unlimited)" },
        maxConcurrentPerRepo: { type: "number", description: "Max concurrent per repo (0=unlimited)" },
        createdBy: { type: "string", description: "Creator identifier" },
        states: {
          type: "array",
          description: "State definitions (at least one required; must include initialState)",
          items: { type: "object" },
        },
      },
      required: ["name", "initialState", "states"],
    },
  },
  {
    name: "admin.flow.update",
    description: "Update a flow's metadata (description, concurrency limits, etc.).",
    inputSchema: {
      type: "object" as const,
      properties: {
        flow_name: { type: "string", description: "Flow name to update" },
        description: { type: "string" },
        maxConcurrent: { type: "number" },
        maxConcurrentPerRepo: { type: "number" },
        initialState: { type: "string" },
      },
      required: ["flow_name"],
    },
  },
  {
    name: "admin.state.create",
    description: "Add a state to an existing flow.",
    inputSchema: {
      type: "object" as const,
      properties: {
        flow_name: { type: "string", description: "Flow name" },
        name: { type: "string", description: "State name" },
        agentRole: { type: "string" },
        modelTier: { type: "string" },
        mode: { type: "string", description: "passive or active" },
        promptTemplate: { type: "string" },
        constraints: { type: "object" },
      },
      required: ["flow_name", "name"],
    },
  },
  {
    name: "admin.state.update",
    description: "Update fields on an existing state.",
    inputSchema: {
      type: "object" as const,
      properties: {
        flow_name: { type: "string", description: "Flow name" },
        state_name: { type: "string", description: "State name to update" },
        agentRole: { type: "string" },
        modelTier: { type: "string" },
        mode: { type: "string" },
        promptTemplate: { type: "string" },
        constraints: { type: "object" },
      },
      required: ["flow_name", "state_name"],
    },
  },
  {
    name: "admin.transition.create",
    description: "Add a transition rule between two states.",
    inputSchema: {
      type: "object" as const,
      properties: {
        flow_name: { type: "string" },
        fromState: { type: "string" },
        toState: { type: "string" },
        trigger: { type: "string" },
        gateName: { type: "string" },
        condition: { type: "string" },
        priority: { type: "number" },
        spawnFlow: { type: "string" },
        spawnTemplate: { type: "string" },
      },
      required: ["flow_name", "fromState", "toState", "trigger"],
    },
  },
  {
    name: "admin.transition.update",
    description: "Update an existing transition rule.",
    inputSchema: {
      type: "object" as const,
      properties: {
        flow_name: { type: "string" },
        transition_id: { type: "string" },
        fromState: { type: "string" },
        toState: { type: "string" },
        trigger: { type: "string" },
        gateName: { type: "string" },
        condition: { type: "string" },
        priority: { type: "number" },
        spawnFlow: { type: "string" },
        spawnTemplate: { type: "string" },
      },
      required: ["flow_name", "transition_id"],
    },
  },
  {
    name: "admin.gate.create",
    description: "Create a gate definition (command, function, or api).",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        type: { type: "string", description: "command | function | api" },
        command: { type: "string" },
        functionRef: { type: "string" },
        apiConfig: { type: "object" },
        timeoutMs: { type: "number" },
      },
      required: ["name", "type"],
    },
  },
  {
    name: "admin.gate.attach",
    description: "Attach a gate to a transition.",
    inputSchema: {
      type: "object" as const,
      properties: {
        flow_name: { type: "string" },
        transition_id: { type: "string" },
        gate_name: { type: "string" },
      },
      required: ["flow_name", "transition_id", "gate_name"],
    },
  },
  {
    name: "admin.flow.snapshot",
    description: "Create a versioned snapshot of the current flow state.",
    inputSchema: {
      type: "object" as const,
      properties: {
        flow_name: { type: "string" },
      },
      required: ["flow_name"],
    },
  },
  {
    name: "admin.flow.restore",
    description: "Restore a flow to a previously snapshotted version.",
    inputSchema: {
      type: "object" as const,
      properties: {
        flow_name: { type: "string" },
        version: { type: "number" },
      },
      required: ["flow_name", "version"],
    },
  },
  {
    name: "admin.integration.set",
    description: "Set or update an integration adapter for a capability.",
    inputSchema: {
      type: "object" as const,
      properties: {
        capability: { type: "string", description: "e.g. issue-tracker, code-host" },
        adapter: { type: "string", description: "e.g. linear, github" },
        config: { type: "object", description: "Adapter-specific configuration" },
      },
      required: ["capability", "adapter"],
    },
  },
];

export function createMcpServer(deps: McpServerDeps): Server {
  const server = new Server({ name: "agentic-flow", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const safeArgs = (args ?? {}) as Record<string, unknown>;
    return callToolHandler(deps, name, safeArgs);
  });

  return server;
}

export async function callToolHandler(deps: McpServerDeps, name: string, safeArgs: Record<string, unknown>) {
  try {
    switch (name) {
      case "flow.claim":
        return await handleFlowClaim(deps, safeArgs);
      case "flow.get_prompt":
        return await handleFlowGetPrompt(deps, safeArgs);
      case "flow.report":
        return await handleFlowReport(deps, safeArgs);
      case "flow.fail":
        return await handleFlowFail(deps, safeArgs);
      case "query.entity":
        return await handleQueryEntity(deps, safeArgs);
      case "query.entities":
        return await handleQueryEntities(deps, safeArgs);
      case "query.invocations":
        return await handleQueryInvocations(deps, safeArgs);
      case "query.flow":
        return await handleQueryFlow(deps, safeArgs);
      case "admin.flow.create":
        return await handleAdminFlowCreate(deps, safeArgs);
      case "admin.flow.update":
        return await handleAdminFlowUpdate(deps, safeArgs);
      case "admin.state.create":
        return await handleAdminStateCreate(deps, safeArgs);
      case "admin.state.update":
        return await handleAdminStateUpdate(deps, safeArgs);
      case "admin.transition.create":
        return await handleAdminTransitionCreate(deps, safeArgs);
      case "admin.transition.update":
        return await handleAdminTransitionUpdate(deps, safeArgs);
      case "admin.gate.create":
        return await handleAdminGateCreate(deps, safeArgs);
      case "admin.gate.attach":
        return await handleAdminGateAttach(deps, safeArgs);
      case "admin.flow.snapshot":
        return await handleAdminFlowSnapshot(deps, safeArgs);
      case "admin.flow.restore":
        return await handleAdminFlowRestore(deps, safeArgs);
      case "admin.integration.set":
        return await handleAdminIntegrationSet(deps, safeArgs);
      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(message);
  }
}

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

// ─── Tool Handlers ───

async function handleFlowClaim(deps: McpServerDeps, args: Record<string, unknown>) {
  const role = args.role as string | undefined;
  if (!role) return errorResult("Missing required parameter: role");

  const flowName = args.flow as string | undefined;

  let candidates: import("../repositories/interfaces.js").Invocation[] = [];

  if (flowName) {
    const flow = await deps.flows.getByName(flowName);
    if (!flow) return errorResult(`Flow not found: ${flowName}`);
    candidates = await deps.invocations.findUnclaimed(flow.id, role);
  } else {
    // No flow specified — search all flows for a claimable entity with this role
    const allFlows = await deps.flows.list();
    for (const flow of allFlows) {
      const unclaimed = await deps.invocations.findUnclaimed(flow.id, role);
      candidates.push(...unclaimed);
      if (candidates.length > 0) break;
    }
  }

  if (candidates.length === 0) return jsonResult(null);

  // Iterate candidates to handle race conditions: try each until one succeeds
  for (const invocation of candidates) {
    let claimed: Awaited<ReturnType<typeof deps.invocations.claim>>;
    try {
      claimed = await deps.invocations.claim(invocation.id, role);
    } catch (err) {
      console.error(`Failed to claim invocation ${invocation.id}:`, err);
      continue;
    }
    if (claimed) {
      return jsonResult({
        entity_id: claimed.entityId,
        invocation_id: claimed.id,
        prompt: claimed.prompt,
        context: claimed.context,
      });
    }
  }

  return jsonResult(null);
}

async function handleFlowGetPrompt(deps: McpServerDeps, args: Record<string, unknown>) {
  const entityId = args.entity_id as string | undefined;
  if (!entityId) return errorResult("Missing required parameter: entity_id");

  const entity = await deps.entities.get(entityId);
  if (!entity) return errorResult(`Entity not found: ${entityId}`);

  const invocationList = await deps.invocations.findByEntity(entityId);
  if (invocationList.length === 0) {
    return errorResult(`No invocations found for entity: ${entityId}`);
  }

  // Return the active (claimed, not completed) invocation rather than the last by insertion order
  const active =
    invocationList.find((inv) => inv.claimedAt !== null && inv.completedAt === null && inv.failedAt === null) ??
    invocationList[invocationList.length - 1];

  return jsonResult({
    prompt: active.prompt,
    context: active.context,
  });
}

async function handleFlowReport(deps: McpServerDeps, args: Record<string, unknown>) {
  const entityId = args.entity_id as string | undefined;
  const signal = args.signal as string | undefined;
  const artifacts = args.artifacts as Record<string, unknown> | undefined;

  if (!entityId) return errorResult("Missing required parameter: entity_id");
  if (!signal) return errorResult("Missing required parameter: signal");

  const invocationList = await deps.invocations.findByEntity(entityId);
  const activeInvocation = invocationList.find(
    (inv) => inv.claimedAt !== null && inv.completedAt === null && inv.failedAt === null,
  );
  if (!activeInvocation) {
    return errorResult(`No active invocation found for entity: ${entityId}`);
  }

  if (!deps.engine) {
    return errorResult("Engine not available — MCP server started without engine dependency");
  }

  // Complete the current invocation BEFORE calling processSignal so the
  // concurrency check inside the engine doesn't count it as still-active.
  await deps.invocations.complete(activeInvocation.id, signal, artifacts);

  // Delegate to the engine — it handles gate evaluation, transition, event
  // emission, invocation creation, concurrency checks, and spawn logic.
  let result: Awaited<ReturnType<typeof deps.engine.processSignal>>;
  try {
    result = await deps.engine.processSignal(entityId, signal, artifacts, activeInvocation.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(message);
  }

  // Gate blocked — create a replacement unclaimed invocation so the entity
  // can be reclaimed; without it the entity would be permanently orphaned.
  if (result.gated) {
    await deps.invocations.create(
      entityId,
      activeInvocation.stage,
      activeInvocation.prompt,
      activeInvocation.mode,
      activeInvocation.agentRole ?? undefined,
    );
    return jsonResult({
      new_state: null,
      gated: true,
      gate_output: result.gateOutput,
      gateName: result.gateName,
      next_action: "waiting",
    });
  }

  // If the engine created a next invocation, fetch its prompt
  let nextPrompt: string | null = null;
  let nextContext: Record<string, unknown> | null = null;
  if (result.invocationId) {
    const nextInvocation = await deps.invocations.get(result.invocationId);
    if (nextInvocation) {
      nextPrompt = nextInvocation.prompt;
      nextContext = nextInvocation.context;
    }
  }

  const nextAction = result.terminal ? "completed" : result.invocationId ? "continue" : "waiting";

  return jsonResult({
    new_state: result.newState,
    gates_passed: result.gatesPassed,
    next_action: nextAction,
    prompt: nextPrompt,
    context: nextContext,
  });
}

async function handleFlowFail(deps: McpServerDeps, args: Record<string, unknown>) {
  const entityId = args.entity_id as string | undefined;
  const error = args.error as string | undefined;

  if (!entityId) return errorResult("Missing required parameter: entity_id");
  if (!error) return errorResult("Missing required parameter: error");

  const invocationList = await deps.invocations.findByEntity(entityId);
  const activeInvocation = invocationList.find(
    (inv) => inv.claimedAt !== null && inv.completedAt === null && inv.failedAt === null,
  );

  if (!activeInvocation) {
    return errorResult(`No active invocation found for entity: ${entityId}`);
  }

  await deps.invocations.fail(activeInvocation.id, error);

  return jsonResult({ acknowledged: true });
}

async function handleQueryEntity(deps: McpServerDeps, args: Record<string, unknown>) {
  const id = args.id as string | undefined;
  if (!id) return errorResult("Missing required parameter: id");

  const entity = await deps.entities.get(id);
  if (!entity) return errorResult(`Entity not found: ${id}`);

  const history = await deps.transitions.historyFor(id);
  return jsonResult({ ...entity, history });
}

async function handleQueryEntities(deps: McpServerDeps, args: Record<string, unknown>) {
  const flowName = args.flow as string | undefined;
  const state = args.state as string | undefined;
  const limit = Math.max(1, Math.min(parseInt(String(args.limit ?? 50), 10) || 50, 100));

  if (!flowName) return errorResult("Missing required parameter: flow");
  if (!state) return errorResult("Missing required parameter: state");

  const flow = await deps.flows.getByName(flowName);
  if (!flow) return errorResult(`Flow not found: ${flowName}`);

  const results = await deps.entities.findByFlowAndState(flow.id, state);
  return jsonResult(results.slice(0, limit));
}

async function handleQueryInvocations(deps: McpServerDeps, args: Record<string, unknown>) {
  const entityId = args.entity_id as string | undefined;
  if (!entityId) return errorResult("Missing required parameter: entity_id");

  const results = await deps.invocations.findByEntity(entityId);
  return jsonResult(results);
}

async function handleQueryFlow(deps: McpServerDeps, args: Record<string, unknown>) {
  const name = args.name as string | undefined;
  if (!name) return errorResult("Missing required parameter: name");

  const flow = await deps.flows.getByName(name);
  if (!flow) return errorResult(`Flow not found: ${name}`);

  return jsonResult(flow);
}

/** Start the MCP server on stdio transport. */
export async function startStdioServer(deps: McpServerDeps): Promise<void> {
  const server = createMcpServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// ─── Admin Helpers ───

function validateInput<T>(
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: { issues: unknown[] } } },
  args: Record<string, unknown>,
): { ok: true; data: T } | { ok: false; result: ReturnType<typeof errorResult> } {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    return { ok: false, result: errorResult(`Validation error: ${JSON.stringify(parsed.error?.issues)}`) };
  }
  return { ok: true, data: parsed.data as T };
}

function emitDefinitionChanged(
  eventRepo: IEventRepository,
  flowId: string | null,
  tool: string,
  payload: Record<string, unknown>,
) {
  void eventRepo.emitDefinitionChanged(flowId, tool, payload);
}

// ─── Admin Tool Handlers ───

async function handleAdminFlowCreate(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(AdminFlowCreateSchema, args);
  if (!v.ok) return v.result;
  const { states, ...flowInput } = v.data;
  if (states !== undefined) {
    const stateNames = states.map((s) => s.name);
    if (!stateNames.includes(flowInput.initialState)) {
      return errorResult(`initialState '${flowInput.initialState}' must be included in the states array`);
    }
  }
  const flow = await deps.flows.create(flowInput);
  for (const stateDef of states ?? []) {
    await deps.flows.addState(flow.id, stateDef);
  }
  const fullFlow = await deps.flows.get(flow.id);
  emitDefinitionChanged(deps.eventRepo, flow.id, "admin.flow.create", { name: flow.name });
  return jsonResult(fullFlow);
}

async function handleAdminFlowUpdate(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(AdminFlowUpdateSchema, args);
  if (!v.ok) return v.result;
  const { flow_name, ...changes } = v.data;
  const flow = await deps.flows.getByName(flow_name);
  if (!flow) return errorResult(`Flow not found: ${flow_name}`);
  await deps.flows.snapshot(flow.id);
  const updated = await deps.flows.update(flow.id, changes);
  emitDefinitionChanged(deps.eventRepo, flow.id, "admin.flow.update", { name: flow_name, changes });
  return jsonResult(updated);
}

async function handleAdminStateCreate(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(AdminStateCreateSchema, args);
  if (!v.ok) return v.result;
  const { flow_name, ...stateInput } = v.data;
  const flow = await deps.flows.getByName(flow_name);
  if (!flow) return errorResult(`Flow not found: ${flow_name}`);
  await deps.flows.snapshot(flow.id);
  const state = await deps.flows.addState(flow.id, stateInput);
  emitDefinitionChanged(deps.eventRepo, flow.id, "admin.state.create", { name: state.name });
  return jsonResult(state);
}

async function handleAdminStateUpdate(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(AdminStateUpdateSchema, args);
  if (!v.ok) return v.result;
  const { flow_name, state_name, ...changes } = v.data;
  const flow = await deps.flows.getByName(flow_name);
  if (!flow) return errorResult(`Flow not found: ${flow_name}`);
  const stateDef = flow.states.find((s) => s.name === state_name);
  if (!stateDef) return errorResult(`State not found: ${state_name} in flow ${flow_name}`);
  await deps.flows.snapshot(flow.id);
  const updated = await deps.flows.updateState(stateDef.id, changes);
  emitDefinitionChanged(deps.eventRepo, flow.id, "admin.state.update", { name: state_name, changes });
  return jsonResult(updated);
}

async function handleAdminTransitionCreate(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(AdminTransitionCreateSchema, args);
  if (!v.ok) return v.result;
  const { flow_name, gateName, ...transitionInput } = v.data;
  const flow = await deps.flows.getByName(flow_name);
  if (!flow) return errorResult(`Flow not found: ${flow_name}`);
  const stateNames = flow.states.map((s) => s.name);
  if (!stateNames.includes(transitionInput.fromState)) {
    return errorResult(`State not found: '${transitionInput.fromState}' in flow '${flow_name}'`);
  }
  if (!stateNames.includes(transitionInput.toState)) {
    return errorResult(`State not found: '${transitionInput.toState}' in flow '${flow_name}'`);
  }
  await deps.flows.snapshot(flow.id);
  let gateId: string | undefined;
  if (gateName) {
    const gate = await deps.gates.getByName(gateName);
    if (!gate) return errorResult(`Gate not found: ${gateName}`);
    gateId = gate.id;
  }
  const transition = await deps.flows.addTransition(flow.id, { ...transitionInput, gateId });
  emitDefinitionChanged(deps.eventRepo, flow.id, "admin.transition.create", {
    fromState: transitionInput.fromState,
    toState: transitionInput.toState,
    trigger: transitionInput.trigger,
  });
  return jsonResult(transition);
}

async function handleAdminTransitionUpdate(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(AdminTransitionUpdateSchema, args);
  if (!v.ok) return v.result;
  const { flow_name, transition_id, gateName, ...changes } = v.data;
  const flow = await deps.flows.getByName(flow_name);
  if (!flow) return errorResult(`Flow not found: ${flow_name}`);
  const existing = flow.transitions.find((t) => t.id === transition_id);
  if (!existing) return errorResult(`Transition not found: ${transition_id} in flow ${flow_name}`);
  const stateNames = flow.states.map((s) => s.name);
  if (changes.fromState !== undefined && !stateNames.includes(changes.fromState)) {
    return errorResult(`State not found: '${changes.fromState}' in flow '${flow_name}'`);
  }
  if (changes.toState !== undefined && !stateNames.includes(changes.toState)) {
    return errorResult(`State not found: '${changes.toState}' in flow '${flow_name}'`);
  }
  await deps.flows.snapshot(flow.id);
  const updateChanges: Record<string, unknown> = { ...changes };
  if (gateName !== undefined) {
    if (gateName) {
      const gate = await deps.gates.getByName(gateName);
      if (!gate) return errorResult(`Gate not found: ${gateName}`);
      updateChanges.gateId = gate.id;
    } else {
      updateChanges.gateId = null;
    }
  }
  const updated = await deps.flows.updateTransition(
    transition_id,
    updateChanges as import("../repositories/interfaces.js").UpdateTransitionInput,
  );
  emitDefinitionChanged(deps.eventRepo, flow.id, "admin.transition.update", { transition_id });
  return jsonResult(updated);
}

async function handleAdminGateCreate(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(AdminGateCreateSchema, args);
  if (!v.ok) return v.result;
  const gate = await deps.gates.create(v.data);
  emitDefinitionChanged(deps.eventRepo, null, "admin.gate.create", { name: gate.name });
  return jsonResult(gate);
}

async function handleAdminGateAttach(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(AdminGateAttachSchema, args);
  if (!v.ok) return v.result;
  const { flow_name, transition_id, gate_name } = v.data;
  const flow = await deps.flows.getByName(flow_name);
  if (!flow) return errorResult(`Flow not found: ${flow_name}`);
  const existing = flow.transitions.find((t) => t.id === transition_id);
  if (!existing) return errorResult(`Transition not found: ${transition_id} in flow ${flow_name}`);
  const gate = await deps.gates.getByName(gate_name);
  if (!gate) return errorResult(`Gate not found: ${gate_name}`);
  await deps.flows.snapshot(flow.id);
  const updated = await deps.flows.updateTransition(transition_id, { gateId: gate.id });
  emitDefinitionChanged(deps.eventRepo, flow.id, "admin.gate.attach", { transition_id, gate_name });
  return jsonResult(updated);
}

async function handleAdminFlowSnapshot(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(AdminFlowSnapshotSchema, args);
  if (!v.ok) return v.result;
  const flow = await deps.flows.getByName(v.data.flow_name);
  if (!flow) return errorResult(`Flow not found: ${v.data.flow_name}`);
  const version = await deps.flows.snapshot(flow.id);
  return jsonResult(version);
}

async function handleAdminFlowRestore(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(AdminFlowRestoreSchema, args);
  if (!v.ok) return v.result;
  const flow = await deps.flows.getByName(v.data.flow_name);
  if (!flow) return errorResult(`Flow not found: ${v.data.flow_name}`);
  await deps.flows.snapshot(flow.id);
  await deps.flows.restore(flow.id, v.data.version);
  emitDefinitionChanged(deps.eventRepo, flow.id, "admin.flow.restore", { version: v.data.version });
  return jsonResult({ restored: true, version: v.data.version });
}

async function handleAdminIntegrationSet(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(AdminIntegrationSetSchema, args);
  if (!v.ok) return v.result;
  const { capability, adapter, config } = v.data;
  const result = await deps.integrationRepo.set(capability, adapter, config);
  emitDefinitionChanged(deps.eventRepo, null, "admin.integration.set", { capability, adapter });
  return jsonResult(result);
}
