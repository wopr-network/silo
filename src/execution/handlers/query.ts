import type { McpServerDeps } from "../mcp-helpers.js";
import { errorResult, jsonResult, validateInput } from "../mcp-helpers.js";
import { QueryEntitiesSchema, QueryEntitySchema, QueryFlowSchema, QueryInvocationsSchema } from "../tool-schemas.js";

export async function handleQueryEntity(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(QueryEntitySchema, args);
  if (!v.ok) return v.result;
  const { id } = v.data;

  const entity = await deps.entities.get(id);
  if (!entity) return errorResult(`Entity not found: ${id}`);

  const history = await deps.transitions.historyFor(id);
  return jsonResult({ ...entity, history });
}

export async function handleQueryEntities(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(QueryEntitiesSchema, args);
  if (!v.ok) return v.result;
  const { flow: flowName, state, limit } = v.data;
  const effectiveLimit = limit ?? 50;

  const flow = await deps.flows.getByName(flowName);
  if (!flow) return errorResult(`Flow not found: ${flowName}`);

  const results = await deps.entities.findByFlowAndState(flow.id, state, effectiveLimit);
  return jsonResult(results);
}

export async function handleQueryInvocations(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(QueryInvocationsSchema, args);
  if (!v.ok) return v.result;
  const { entity_id: entityId } = v.data;

  const results = await deps.invocations.findByEntity(entityId);
  return jsonResult(results);
}

export async function handleQueryFlow(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(QueryFlowSchema, args);
  if (!v.ok) return v.result;
  const { name } = v.data;

  const flow = await deps.flows.getByName(name);
  if (!flow) return errorResult(`Flow not found: ${name}`);

  return jsonResult(flow);
}

export async function handleQueryFlows(deps: McpServerDeps) {
  const flows = await deps.flows.list();
  return jsonResult(
    flows.map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description,
      initialState: f.initialState,
      discipline: f.discipline,
      version: f.version,
      states: f.states.map(({ id, flowId, name, modelTier, mode, constraints, onEnter }) => ({
        id,
        flowId,
        name,
        modelTier,
        mode,
        constraints,
        onEnter,
      })),
      transitions: f.transitions,
    })),
  );
}
