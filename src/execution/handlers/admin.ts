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
} from "../admin-schemas.js";
import type { McpServerDeps } from "../mcp-helpers.js";
import { emitDefinitionChanged, errorResult, jsonResult, validateInput } from "../mcp-helpers.js";
import { FlowSeedSchema } from "../tool-schemas.js";

export async function handleAdminEntityCreate(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(FlowSeedSchema, args);
  if (!v.ok) return v.result;
  const { flow: flowName, refs } = v.data;

  if (!deps.engine) {
    return errorResult("Engine not available — MCP server started without engine dependency");
  }

  const entity = await deps.engine.createEntity(flowName, refs);
  const invocations = await deps.invocations.findByEntity(entity.id);
  const activeInvocation = invocations.find((inv) => !inv.completedAt && !inv.failedAt);
  const result: Record<string, unknown> = { ...entity };
  if (activeInvocation) {
    result.invocation_id = activeInvocation.id;
  }
  return jsonResult(result);
}

export async function handleAdminFlowCreate(deps: McpServerDeps, args: Record<string, unknown>) {
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

export async function handleAdminFlowUpdate(deps: McpServerDeps, args: Record<string, unknown>) {
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

export async function handleAdminStateCreate(deps: McpServerDeps, args: Record<string, unknown>) {
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

export async function handleAdminStateUpdate(deps: McpServerDeps, args: Record<string, unknown>) {
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

export async function handleAdminTransitionCreate(deps: McpServerDeps, args: Record<string, unknown>) {
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

export async function handleAdminTransitionUpdate(deps: McpServerDeps, args: Record<string, unknown>) {
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
    updateChanges as import("../../repositories/interfaces.js").UpdateTransitionInput,
  );
  emitDefinitionChanged(deps.eventRepo, flow.id, "admin.transition.update", { transition_id });
  return jsonResult(updated);
}

export async function handleAdminGateCreate(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(AdminGateCreateSchema, args);
  if (!v.ok) return v.result;
  const gate = await deps.gates.create(v.data);
  emitDefinitionChanged(deps.eventRepo, null, "admin.gate.create", { name: gate.name });
  return jsonResult(gate);
}

export async function handleAdminGateAttach(deps: McpServerDeps, args: Record<string, unknown>) {
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

export async function handleAdminFlowSnapshot(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(AdminFlowSnapshotSchema, args);
  if (!v.ok) return v.result;
  const flow = await deps.flows.getByName(v.data.flow_name);
  if (!flow) return errorResult(`Flow not found: ${v.data.flow_name}`);
  const version = await deps.flows.snapshot(flow.id);
  return jsonResult(version);
}

export async function handleAdminFlowRestore(deps: McpServerDeps, args: Record<string, unknown>) {
  const v = validateInput(AdminFlowRestoreSchema, args);
  if (!v.ok) return v.result;
  const flow = await deps.flows.getByName(v.data.flow_name);
  if (!flow) return errorResult(`Flow not found: ${v.data.flow_name}`);
  await deps.flows.snapshot(flow.id);
  await deps.flows.restore(flow.id, v.data.version);
  emitDefinitionChanged(deps.eventRepo, flow.id, "admin.flow.restore", { version: v.data.version });
  return jsonResult({ restored: true, version: v.data.version });
}
