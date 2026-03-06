import type { Entity, Gate, State } from "../repositories/interfaces.js";
import { getHandlebars } from "./handlebars.js";

/**
 * Build an invocation prompt by resolving refs, assembling context, and hydrating the template.
 *
 * @param entity      The runtime entity
 * @param state       The state definition (contains promptTemplate, agentRole, etc.)
 * @param adapters    Map of adapter name -> adapter instance (each must have `.get(id)`)
 * @param invocations Optional array of prior invocations (each with `.stage`) for metadata
 */
interface Adapter {
  get(id: string): Promise<unknown>;
}

export async function buildInvocation(
  entity: Entity,
  state: State,
  adapters: Map<string, Adapter>,
  invocations: { stage: string }[] = [],
): Promise<{ prompt: string; context: Record<string, unknown> }> {
  const hbs = getHandlebars();

  // 1. Local artifacts
  const artifacts: Record<string, unknown> = entity.artifacts ?? {};

  // 2. Resolve refs
  const refs: Record<string, unknown> = {};
  if (entity.refs) {
    const entries = Object.entries(entity.refs);
    await Promise.all(
      entries.map(async ([key, ref]) => {
        const adapter = adapters.get(ref.adapter);
        if (!adapter) return;
        try {
          refs[key] = await adapter.get(ref.id);
        } catch {
          // skip failed ref resolution
        }
      }),
    );
  }

  // 3. Pipeline metadata
  const invocationCount = invocations.filter((i) => i.stage === state.name).length;
  const totalInvocations = invocations.length;
  const timeInState = Date.now() - new Date(entity.updatedAt).getTime();

  // 4. Assemble context
  const context: Record<string, unknown> = {
    artifacts,
    refs,
    agent_role: state.agentRole ?? null,
    invocation_count: invocationCount,
    total_invocations: totalInvocations,
    time_in_state: timeInState,
    entity: {
      ...entity,
      invocations,
      gateResults: [],
    },
  };

  // 5. Compile + execute template
  if (!state.promptTemplate) {
    return { prompt: "", context };
  }

  const template = hbs.compile(state.promptTemplate);
  const prompt = template(context);

  return { prompt, context };
}

/**
 * Hydrate a gate's command template with the given context.
 */
export function hydrateGateCommand(gate: Gate, context: Record<string, unknown>): string {
  if (!gate.command) return "";
  const hbs = getHandlebars();
  const template = hbs.compile(gate.command);
  return template(context);
}
