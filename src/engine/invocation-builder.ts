import Handlebars from "handlebars";
import type { Entity, Mode, State } from "../repositories/interfaces.js";

export interface InvocationBuild {
  prompt: string;
  agentRole: string | null;
  mode: Mode;
  context: Record<string, unknown>;
}

/**
 * Build an invocation's prompt and context from a state definition and entity.
 * Uses Handlebars to render the prompt template with entity data.
 */
export function buildInvocation(state: State, entity: Entity): InvocationBuild {
  let prompt = "";
  if (state.promptTemplate) {
    const template = Handlebars.compile(state.promptTemplate);
    prompt = template({ entity, state });
  }

  return {
    prompt,
    agentRole: state.agentRole,
    mode: state.mode,
    context: { entity, state },
  };
}
