// MCP server — passive mode (flow.claim, flow.report, query.*)
import { createHash, timingSafeEqual } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Engine } from "../engine/engine.js";
import type {
  IEntityRepository,
  IEventRepository,
  IFlowRepository,
  IGateRepository,
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
  AdminStateCreateSchema,
  AdminStateUpdateSchema,
  AdminTransitionCreateSchema,
  AdminTransitionUpdateSchema,
} from "./admin-schemas.js";
import {
  FlowClaimSchema,
  FlowFailSchema,
  FlowGetPromptSchema,
  FlowReportSchema,
  QueryEntitiesSchema,
  QueryEntitySchema,
  QueryFlowSchema,
  QueryInvocationsSchema,
} from "./tool-schemas.js";

export interface McpServerDeps {
  entities: IEntityRepository;
  flows: IFlowRepository;
  invocations: IInvocationRepository;
  gates: IGateRepository;
  transitions: ITransitionLogRepository;
  eventRepo: IEventRepository;
  engine?: Engine;
}

export interface McpServerOpts {
  /** DEFCON_ADMIN_TOKEN — if set, admin.* tools require this token */
  adminToken?: string;
  /** Token provided by the caller (from HTTP Authorization header, or undefined for stdio) */
  callerToken?: string;
  /** When true, skip token validation (stdio is local-process-only and inherently trusted) */
  stdioTrusted?: boolean;
}

const TOOL_DEFINITIONS = [
  {
    name: "flow.claim",
    description:
      "Claim the next available work item for a given discipline role. DEFCON selects the highest-priority entity across all matching flows. Returns entity_id, invocation_id, flow, stage, prompt — or null if no work is available.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workerId: { type: "string", description: "Unique worker identifier for affinity tracking" },
        role: { type: "string", description: "Discipline role (e.g. engineering, devops, qa, security)" },
        flow: { type: "string", description: "Optional flow name to restrict claim to a single flow" },
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
    description:
      "Report completion of work on an entity. Triggers state transition and gate evaluation. " +
      'Returns next_action: "continue" (next prompt ready), "waiting" (gate explicitly failed — stop until something external changes), ' +
      '"check_back" (gate is still evaluating — this is not an error, call flow.report again with the same arguments after retry_after_ms), ' +
      'or "completed" (terminal state). ' +
      "gates_passed contains gate names (not IDs).",
    inputSchema: {
      type: "object" as const,
      properties: {
        entity_id: { type: "string", description: "Entity ID" },
        signal: {
          type: "string",
          description: "Completion signal (matches transition trigger)",
        },
        artifacts: { type: "object", description: "Optional artifacts to attach" },
        worker_id: { type: "string", description: "Optional stable worker identifier for affinity routing" },
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
        discipline: {
          type: "string",
          description:
            "Discipline role required to claim work in this flow (e.g. engineering, devops). Null means any role can claim.",
        },
        description: { type: "string", description: "Flow description" },
        entitySchema: { type: "object", description: "JSON schema for entity data" },
        maxConcurrent: { type: "number", description: "Max concurrent entities (0=unlimited)" },
        maxConcurrentPerRepo: { type: "number", description: "Max concurrent per repo (0=unlimited)" },
        affinityWindowMs: { type: "number", description: "Worker affinity window duration in ms (default 300000)" },
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
        discipline: { type: "string", description: "Discipline role required to claim work in this flow" },
        maxConcurrent: { type: "number" },
        maxConcurrentPerRepo: { type: "number" },
        affinityWindowMs: { type: "number", description: "Worker affinity window duration in ms (default 300000)" },
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
        failurePrompt: { type: "string" },
        timeoutPrompt: { type: "string" },
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
];

export function createMcpServer(deps: McpServerDeps, opts?: McpServerOpts): Server {
  const server = new Server({ name: "agentic-flow", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const safeArgs = (args ?? {}) as Record<string, unknown>;
    return callToolHandler(deps, name, safeArgs, opts);
  });

  return server;
}

export async function callToolHandler(
  deps: McpServerDeps,
  name: string,
  safeArgs: Record<string, unknown>,
  opts?: McpServerOpts,
) {
  try {
    // Auth gate: admin.* tools require a valid token when one is configured
    if (name.startsWith("admin.")) {
      const configuredToken = opts?.adminToken || undefined; // treat "" as unset
      if (configuredToken && !opts?.stdioTrusted) {
        const callerToken = opts?.callerToken;
        if (!callerToken || !constantTimeEqual(configuredToken, callerToken)) {
          return errorResult("Unauthorized: admin tools require authentication. Check server configuration.");
        }
      }
    }

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

function constantTimeEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a.trim()).digest();
  const hashB = createHash("sha256").update(b.trim()).digest();
  return timingSafeEqual(hashA, hashB);
}

// ─── Tool Handlers ───

const AFFINITY_WINDOW_MS = 60 * 60 * 1000; // 1 hour

async function handleFlowClaim(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(FlowClaimSchema, args);
  if (!v.ok) return v.result;
  const { workerId, role, flow: flowName } = v.data;

  // 1. Find candidate flows filtered by discipline
  let candidateFlows: import("../repositories/interfaces.js").Flow[] = [];

  if (flowName) {
    const flow = await deps.flows.getByName(flowName);
    if (!flow) return errorResult(`Flow not found: ${flowName}`);
    // Discipline must match — null discipline flows are claimable by any role
    if (flow.discipline !== null && flow.discipline !== role) return jsonResult(null);
    candidateFlows = [flow];
  } else {
    const allFlows = await deps.flows.list();
    candidateFlows = allFlows.filter((f) => f.discipline === null || f.discipline === role);
  }

  if (candidateFlows.length === 0) return jsonResult(null);

  // 2. Gather all unclaimed invocations across matching flows
  type CandidateInvocation = import("../repositories/interfaces.js").Invocation;
  const allCandidates: CandidateInvocation[] = [];
  for (const flow of candidateFlows) {
    const unclaimed = await deps.invocations.findUnclaimedByFlow(flow.id);
    allCandidates.push(...unclaimed);
  }

  if (allCandidates.length === 0) return jsonResult(null);

  // 3. Load entities for priority sorting
  const entityMap = new Map<string, import("../repositories/interfaces.js").Entity>();
  const uniqueEntityIds = [...new Set(allCandidates.map((inv) => inv.entityId))];
  await Promise.all(
    uniqueEntityIds.map(async (eid) => {
      const entity = await deps.entities.get(eid);
      if (entity) entityMap.set(eid, entity);
    }),
  );

  // 4. Check affinity for each entity
  const affinitySet = new Set<string>();
  const now = Date.now();
  if (workerId) {
    await Promise.all(
      uniqueEntityIds.map(async (eid) => {
        const invocations = await deps.invocations.findByEntity(eid);
        const lastCompleted = invocations
          .filter((inv) => inv.completedAt !== null && inv.claimedBy === workerId)
          .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
        if (lastCompleted.length > 0) {
          const elapsed = now - (lastCompleted[0].completedAt?.getTime() ?? 0);
          if (elapsed < AFFINITY_WINDOW_MS) {
            affinitySet.add(eid);
          }
        }
      }),
    );
  }

  // 5. Sort candidates by priority algorithm
  allCandidates.sort((a, b) => {
    const entityA = entityMap.get(a.entityId);
    const entityB = entityMap.get(b.entityId);

    // Tier 1: Affinity (has affinity sorts first)
    const affinityA = affinitySet.has(a.entityId) ? 1 : 0;
    const affinityB = affinitySet.has(b.entityId) ? 1 : 0;
    if (affinityA !== affinityB) return affinityB - affinityA;

    // Tier 2: Entity priority (higher priority sorts first)
    const priA = entityA?.priority ?? 0;
    const priB = entityB?.priority ?? 0;
    if (priA !== priB) return priB - priA;

    // Tier 3: Time in state (longest waiting sorts first — earlier createdAt as stable proxy)
    const timeA = entityA?.createdAt?.getTime() ?? now;
    const timeB = entityB?.createdAt?.getTime() ?? now;
    return timeA - timeB;
  });

  // 6. Build a flow lookup map
  const flowById = new Map(candidateFlows.map((f) => [f.id, f]));

  // 7. Try claiming in priority order (handle race conditions)
  for (const invocation of allCandidates) {
    let claimed: Awaited<ReturnType<typeof deps.invocations.claim>>;
    try {
      claimed = await deps.invocations.claim(invocation.id, workerId ?? `agent:${role}`);
    } catch (err) {
      console.error(`Failed to claim invocation ${invocation.id}:`, err);
      continue;
    }
    if (claimed) {
      const entity = entityMap.get(claimed.entityId);
      if (entity) {
        const claimedEntity = await deps.entities.claimById(entity.id, workerId ?? `agent:${role}`);
        if (!claimedEntity) {
          // Race condition: another worker claimed this entity first.
          // Release the invocation claim so it can be picked up by another worker.
          await deps.invocations.releaseClaim(claimed.id);
          continue;
        }
      }
      const flow = entity ? flowById.get(entity.flowId) : undefined;
      // Record affinity for the claiming worker
      if (workerId && entity && flow) {
        const windowMs = flow.affinityWindowMs ?? 300000;
        await deps.entities.setAffinity(claimed.entityId, workerId, role, new Date(Date.now() + windowMs));
      }
      return jsonResult({
        workerId,
        entity_id: claimed.entityId,
        invocation_id: claimed.id,
        flow: flow?.name ?? null,
        stage: claimed.stage,
        prompt: claimed.prompt,
        context: claimed.context,
      });
    }
  }

  return jsonResult(null);
}

async function handleFlowGetPrompt(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(FlowGetPromptSchema, args);
  if (!v.ok) return v.result;
  const { entity_id: entityId } = v.data;

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
  const v = validateInput(FlowReportSchema, args);
  if (!v.ok) return v.result;
  const { entity_id: entityId, signal, artifacts, worker_id: workerId } = v.data;

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
    // processSignal failed after we already completed the invocation — create a
    // replacement so the entity can be reclaimed rather than being permanently orphaned.
    await deps.invocations.create(
      entityId,
      activeInvocation.stage,
      activeInvocation.prompt,
      activeInvocation.mode,
      activeInvocation.agentRole ?? undefined,
    );
    return errorResult(message);
  }

  // Set affinity on completion for passive-mode invocations, after processSignal succeeds
  if (workerId && activeInvocation.mode === "passive" && activeInvocation.agentRole) {
    try {
      const entity = await deps.entities.get(entityId);
      if (entity) {
        const flow = await deps.flows.get(entity.flowId);
        const windowMs = flow?.affinityWindowMs ?? 300000;
        await deps.entities.setAffinity(
          entityId,
          workerId,
          activeInvocation.agentRole,
          new Date(Date.now() + windowMs),
        );
      }
    } catch (err) {
      console.error(`Failed to set affinity for entity ${entityId} worker ${workerId}:`, err);
    }
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

    if (result.gateTimedOut) {
      return jsonResult({
        next_action: "check_back",
        message:
          "Your report was received. The gate is still evaluating — this is not an error. Call flow.claim to reclaim the entity, then call flow.report again with the same arguments after a short wait.",
        retry_after_ms: 30000,
        timeout_prompt: result.timeoutPrompt ?? null,
      });
    }

    return jsonResult({
      new_state: null,
      gated: true,
      gate_output: result.gateOutput,
      gateName: result.gateName,
      next_action: "waiting",
      failure_prompt: result.failurePrompt ?? null,
      timeout_prompt: result.timeoutPrompt ?? null,
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
  const v = validateInput(FlowFailSchema, args);
  if (!v.ok) return v.result;
  const { entity_id: entityId, error } = v.data;

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
  const v = validateInput(QueryEntitySchema, args);
  if (!v.ok) return v.result;
  const { id } = v.data;

  const entity = await deps.entities.get(id);
  if (!entity) return errorResult(`Entity not found: ${id}`);

  const history = await deps.transitions.historyFor(id);
  return jsonResult({ ...entity, history });
}

async function handleQueryEntities(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(QueryEntitiesSchema, args);
  if (!v.ok) return v.result;
  const { flow: flowName, state, limit } = v.data;
  const effectiveLimit = limit ?? 50;

  const flow = await deps.flows.getByName(flowName);
  if (!flow) return errorResult(`Flow not found: ${flowName}`);

  const results = await deps.entities.findByFlowAndState(flow.id, state);
  return jsonResult(results.slice(0, effectiveLimit));
}

async function handleQueryInvocations(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(QueryInvocationsSchema, args);
  if (!v.ok) return v.result;
  const { entity_id: entityId } = v.data;

  const results = await deps.invocations.findByEntity(entityId);
  return jsonResult(results);
}

async function handleQueryFlow(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(QueryFlowSchema, args);
  if (!v.ok) return v.result;
  const { name } = v.data;

  const flow = await deps.flows.getByName(name);
  if (!flow) return errorResult(`Flow not found: ${name}`);

  return jsonResult(flow);
}

/** Start the MCP server on stdio transport. */
export async function startStdioServer(deps: McpServerDeps, opts?: McpServerOpts): Promise<void> {
  const server = createMcpServer(deps, opts);
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
