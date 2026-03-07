// MCP server — passive mode (flow.claim, flow.report, query.*)
import { createHash, timingSafeEqual } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export type { McpServerDeps } from "./mcp-helpers.js";
export { emitDefinitionChanged, errorResult, jsonResult, validateInput } from "./mcp-helpers.js";

import {
  handleAdminEntityCreate,
  handleAdminFlowCreate,
  handleAdminFlowRestore,
  handleAdminFlowSnapshot,
  handleAdminFlowUpdate,
  handleAdminGateAttach,
  handleAdminGateCreate,
  handleAdminStateCreate,
  handleAdminStateUpdate,
  handleAdminTransitionCreate,
  handleAdminTransitionUpdate,
} from "./handlers/admin.js";
import { handleFlowClaim, handleFlowFail, handleFlowGetPrompt, handleFlowReport } from "./handlers/flow.js";
import {
  handleQueryEntities,
  handleQueryEntity,
  handleQueryFlow,
  handleQueryFlows,
  handleQueryInvocations,
} from "./handlers/query.js";
import type { McpServerDeps } from "./mcp-helpers.js";
import { errorResult } from "./mcp-helpers.js";

export interface McpServerOpts {
  /** DEFCON_ADMIN_TOKEN — if set, admin.* tools require this token */
  adminToken?: string;
  /** DEFCON_WORKER_TOKEN — if set, flow.* tools require this token */
  workerToken?: string;
  /** Token provided by the caller (from HTTP Authorization header, or undefined for stdio) */
  callerToken?: string;
  /** When true, skip token validation (stdio is local-process-only and inherently trusted) */
  stdioTrusted?: boolean;
}

function getSystemDefaultGateTimeoutMs(): number {
  const parsed = parseInt(process.env.DEFCON_DEFAULT_GATE_TIMEOUT_MS ?? "", 10);
  return !Number.isNaN(parsed) && parsed > 0 ? parsed : 300000;
}

const SYSTEM_DEFAULT_GATE_TIMEOUT_MS = getSystemDefaultGateTimeoutMs();

const TOOL_DEFINITIONS = [
  {
    name: "flow.claim",
    description:
      "Claim the next available work item for a given discipline role. DEFCON selects the highest-priority entity across all matching flows. Returns entity_id, invocation_id, flow, stage, prompt — or a check_back response with retry_after_ms if no work is available.",
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
      "Report completion of work on an entity. **This call blocks until gate evaluation completes** — " +
      "which may take milliseconds (trivial gate) or many minutes (CI pipeline). Do not set a short client-side " +
      "timeout on this call. For HTTP/SSE transports, configure a long timeout (24h is safe). " +
      "The stdio transport has no timeout by default. " +
      'Returns next_action: "continue" (next prompt ready), "waiting" (gate failed — stop, do not retry), ' +
      '"check_back" (gate timed out — not an error, call flow.report again with the same arguments after retry_after_ms), ' +
      'or "completed" (terminal state). ' +
      "Set gate timeout_ms to the maximum time you are willing to wait, not an expected duration — " +
      "the call returns as soon as the gate resolves. " +
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
  {
    name: "query.flows",
    description: "List all available flow definitions.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
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
        defaultModelTier: {
          type: "string",
          description: "Default model tier for states that don't specify one (opus, sonnet, haiku)",
        },
        description: { type: "string", description: "Flow description" },
        entitySchema: { type: "object", description: "JSON schema for entity data" },
        maxConcurrent: { type: "number", description: "Max concurrent entities (0=unlimited)" },
        maxConcurrentPerRepo: { type: "number", description: "Max concurrent per repo (0=unlimited)" },
        affinityWindowMs: { type: "number", description: "Worker affinity window duration in ms (default 300000)" },
        gateTimeoutMs: {
          type: "number",
          description: `Default gate timeout in ms for all gates in this flow (default ${SYSTEM_DEFAULT_GATE_TIMEOUT_MS})`,
        },
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
        defaultModelTier: { type: "string", description: "Default model tier for states that don't specify one" },
        maxConcurrent: { type: "number" },
        maxConcurrentPerRepo: { type: "number" },
        affinityWindowMs: { type: "number", description: "Worker affinity window duration in ms (default 300000)" },
        gateTimeoutMs: { type: "number", description: "Default gate timeout in ms for all gates in this flow" },
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
  {
    name: "admin.entity.create",
    description:
      "Create a new entity in a flow (seed). Equivalent to POST /api/entities. " +
      "Creates the entity at the flow's initial state and generates the first invocation if the initial state has an agent role. " +
      "Returns the full Entity object plus an optional invocation_id if the initial state created an invocation.",
    // inputSchema mirrors FlowSeedSchema in src/execution/tool-schemas.ts — keep in sync
    inputSchema: {
      type: "object" as const,
      properties: {
        flow: { type: "string", description: "Flow name to create the entity in" },
        refs: {
          type: "object",
          description:
            "Optional external references. Keys are ref names, values are objects with at least { adapter: string, id: string }",
          additionalProperties: {
            type: "object",
            properties: {
              adapter: { type: "string" },
              id: { type: "string" },
            },
            required: ["adapter", "id"],
          },
        },
      },
      required: ["flow"],
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

    // Auth gate: flow.* tools and query.flows require a valid worker token when one is configured
    if (name.startsWith("flow.") || name === "query.flows") {
      const configuredToken = opts?.workerToken?.trim() || undefined; // treat "" or whitespace-only as unset
      if (configuredToken && !opts?.stdioTrusted) {
        const callerToken = opts?.callerToken;
        if (!callerToken || !constantTimeEqual(configuredToken, callerToken)) {
          return errorResult("Unauthorized: worker tools require authentication. Check server configuration.");
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
      case "query.flows":
        return await handleQueryFlows(deps);
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
      case "admin.entity.create":
        return await handleAdminEntityCreate(deps, safeArgs);
      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(message);
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a.trim()).digest();
  const hashB = createHash("sha256").update(b.trim()).digest();
  return timingSafeEqual(hashA, hashB);
}

/** Start the MCP server on stdio transport. */
export async function startStdioServer(deps: McpServerDeps, opts?: McpServerOpts): Promise<void> {
  const server = createMcpServer(deps, opts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
