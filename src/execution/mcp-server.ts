// MCP server — passive mode (flow.claim, flow.report, query.*)
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type {
  IEntityRepository,
  IFlowRepository,
  IGateRepository,
  IInvocationRepository,
  ITransitionLogRepository,
} from "../repositories/interfaces.js";

export interface McpServerDeps {
  entities: IEntityRepository;
  flows: IFlowRepository;
  invocations: IInvocationRepository;
  gates: IGateRepository;
  transitions: ITransitionLogRepository;
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
];

export function createMcpServer(deps: McpServerDeps): Server {
  const server = new Server({ name: "agentic-flow", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const safeArgs = (args ?? {}) as Record<string, unknown>;
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
        default:
          return errorResult(`Unknown tool: ${name}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResult(message);
    }
  });

  return server;
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
  if (!flowName) {
    return errorResult("Parameter 'flow' is required when no default flow is configured");
  }

  const flow = await deps.flows.getByName(flowName);
  if (!flow) return errorResult(`Flow not found: ${flowName}`);

  const unclaimed = await deps.invocations.findUnclaimed(flow.id, role);
  if (unclaimed.length === 0) return jsonResult(null);

  const invocation = unclaimed[0];
  const claimed = await deps.invocations.claim(invocation.id, role);
  if (!claimed) return jsonResult(null);

  return jsonResult({
    entity_id: claimed.entityId,
    invocation_id: claimed.id,
    prompt: claimed.prompt,
    context: claimed.context,
  });
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

  const latest = invocationList[invocationList.length - 1];
  return jsonResult({
    prompt: latest.prompt,
    context: latest.context,
  });
}

async function handleFlowReport(deps: McpServerDeps, args: Record<string, unknown>) {
  const entityId = args.entity_id as string | undefined;
  const signal = args.signal as string | undefined;
  const artifacts = args.artifacts as Record<string, unknown> | undefined;

  if (!entityId) return errorResult("Missing required parameter: entity_id");
  if (!signal) return errorResult("Missing required parameter: signal");

  const entity = await deps.entities.get(entityId);
  if (!entity) return errorResult(`Entity not found: ${entityId}`);

  const invocationList = await deps.invocations.findByEntity(entityId);
  const activeInvocation = invocationList.find(
    (inv) => inv.claimedAt !== null && inv.completedAt === null && inv.failedAt === null,
  );
  if (!activeInvocation) {
    return errorResult(`No active invocation found for entity: ${entityId}`);
  }

  await deps.invocations.complete(activeInvocation.id, signal, artifacts);

  const flow = await deps.flows.get(entity.flowId);
  if (!flow) return errorResult(`Flow not found for entity: ${entityId}`);

  const transition = flow.transitions.find((t) => t.fromState === entity.state && t.trigger === signal);

  if (!transition) {
    return jsonResult({
      new_state: entity.state,
      gates_passed: [],
      next_action: "waiting",
    });
  }

  const gatesPassed: string[] = [];
  if (transition.gateId) {
    const gate = await deps.gates.get(transition.gateId);
    if (gate) {
      await deps.gates.record(entityId, gate.id, true, "auto-pass");
      gatesPassed.push(gate.name);
    }
  }

  const updated = await deps.entities.transition(entityId, transition.toState, signal, artifacts);

  await deps.transitions.record({
    entityId,
    fromState: entity.state,
    toState: transition.toState,
    trigger: signal,
    invocationId: activeInvocation.id,
    timestamp: new Date(),
  });

  const newStateDef = flow.states.find((s) => s.name === transition.toState);
  let nextAction: "claimed" | "waiting" | "completed" = "waiting";

  if (newStateDef?.mode === "passive" && newStateDef.promptTemplate) {
    await deps.invocations.create(
      entityId,
      transition.toState,
      newStateDef.promptTemplate,
      "passive",
      newStateDef.agentRole ?? undefined,
    );
  }

  const hasOutgoing = flow.transitions.some((t) => t.fromState === transition.toState);
  if (!hasOutgoing) {
    nextAction = "completed";
  }

  return jsonResult({
    new_state: updated.state,
    gates_passed: gatesPassed,
    next_action: nextAction,
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
  const limit = (args.limit as number | undefined) ?? 50;

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
