import type { IFlowRepository, IGateRepository, IIntegrationConfigRepository } from "../repositories/interfaces.js";
import type { SeedFile } from "./zod-schemas.js";

export async function exportSeed(
  flowRepo: IFlowRepository,
  gateRepo: IGateRepository,
  integrationRepo: IIntegrationConfigRepository,
): Promise<SeedFile> {
  const flows = await flowRepo.listAll();

  // Fetch all gates once, build ID->name map (no N+1)
  const allGates = await gateRepo.listAll();
  const gateIdToName = new Map<string, string>(allGates.map((g) => [g.id, g.name]));
  const gateById = new Map(allGates.map((g) => [g.id, g]));

  // Collect gate IDs referenced by transitions
  const referencedGateIds = new Set<string>();
  for (const flow of flows) {
    for (const t of flow.transitions) {
      if (t.gateId) referencedGateIds.add(t.gateId);
    }
  }

  // Build gates array from referenced gates (already loaded)
  const gateEntries: SeedFile["gates"] = [];
  for (const gateId of referencedGateIds) {
    const gate = gateById.get(gateId);
    if (!gate) continue;
    if (gate.type === "command" && gate.command) {
      gateEntries.push({ name: gate.name, type: "command", command: gate.command, timeoutMs: gate.timeoutMs });
    } else if (gate.type === "function" && gate.functionRef) {
      gateEntries.push({ name: gate.name, type: "function", functionRef: gate.functionRef, timeoutMs: gate.timeoutMs });
    } else if (gate.type === "api" && gate.apiConfig) {
      gateEntries.push({ name: gate.name, type: "api", apiConfig: gate.apiConfig, timeoutMs: gate.timeoutMs });
    }
  }

  const seedFlows: SeedFile["flows"] = flows.map((f) => ({
    name: f.name,
    description: f.description ?? undefined,
    entitySchema: f.entitySchema ?? undefined,
    initialState: f.initialState,
    maxConcurrent: f.maxConcurrent,
    maxConcurrentPerRepo: f.maxConcurrentPerRepo,
    version: f.version,
    createdBy: f.createdBy ?? undefined,
  }));

  const seedStates: SeedFile["states"] = flows.flatMap((f) =>
    f.states.map((s) => ({
      name: s.name,
      flowName: f.name,
      agentRole: s.agentRole ?? undefined,
      modelTier: s.modelTier ?? undefined,
      mode: s.mode,
      promptTemplate: s.promptTemplate ?? undefined,
      constraints: s.constraints ?? undefined,
    })),
  );

  const seedTransitions: SeedFile["transitions"] = flows.flatMap((f) =>
    f.transitions.map((t) => ({
      flowName: f.name,
      fromState: t.fromState,
      toState: t.toState,
      trigger: t.trigger,
      gateName: t.gateId ? gateIdToName.get(t.gateId) : undefined,
      condition: t.condition ?? undefined,
      priority: t.priority,
      spawnFlow: t.spawnFlow ?? undefined,
      spawnTemplate: t.spawnTemplate ?? undefined,
    })),
  );

  const integrationRows = await integrationRepo.listAll();
  const seedIntegrations: SeedFile["integrations"] = integrationRows.map((r) => ({
    capability: r.capability,
    adapter: r.adapter,
    config: r.config ?? undefined,
  }));

  return {
    flows: seedFlows,
    states: seedStates,
    gates: gateEntries,
    transitions: seedTransitions,
    integrations: seedIntegrations,
  };
}
