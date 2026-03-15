// Shared helpers and types for MCP handler modules.
// Extracted here to break the circular dependency between mcp-server.ts and the handler modules.
import type { Engine } from "../engine/engine.js";
import type {
  IEntityRepository,
  IEventRepository,
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
  eventRepo: IEventRepository;
  engine?: Engine;
}

export function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

export type ErrorCode = "NOT_FOUND" | "CONFLICT" | "VALIDATION" | "INTERNAL";

export function errorResult(message: string, errorCode?: ErrorCode) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
    ...(errorCode !== undefined && { errorCode }),
  };
}

export function validateInput<T>(
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: { issues: unknown[] } } },
  args: Record<string, unknown>,
): { ok: true; data: T } | { ok: false; result: ReturnType<typeof errorResult> } {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    return { ok: false, result: errorResult(`Validation error: ${JSON.stringify(parsed.error?.issues)}`) };
  }
  return { ok: true, data: parsed.data as T };
}

export function emitDefinitionChanged(
  eventRepo: IEventRepository,
  flowId: string | null,
  tool: string,
  payload: Record<string, unknown>,
  logger?: { error: (...args: unknown[]) => void },
) {
  eventRepo.emitDefinitionChanged(flowId, tool, payload).catch((err) => {
    logger?.error("[mcp] emitDefinitionChanged error:", err);
  });
}
