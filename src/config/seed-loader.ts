import { readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import type { IFlowRepository, IGateRepository, IIntegrationConfigRepository } from "../repositories/interfaces.js";
import { SeedFileSchema } from "./zod-schemas.js";

export interface LoadSeedResult {
  flows: number;
  gates: number;
  integrations: number;
}

export async function loadSeed(
  seedPath: string,
  flowRepo: IFlowRepository,
  gateRepo: IGateRepository,
  integrationRepo: IIntegrationConfigRepository,
  sqlite: InstanceType<typeof Database>,
): Promise<LoadSeedResult> {
  const raw = readFileSync(seedPath, "utf-8");
  const json = JSON.parse(raw);
  const parsed = SeedFileSchema.parse(json);

  sqlite.exec("BEGIN");
  try {
    // 1. Create gates first (transitions reference them by name)
    const gateNameToId = new Map<string, string>();
    for (const g of parsed.gates) {
      const gate = await gateRepo.create({
        name: g.name,
        type: g.type,
        command: "command" in g ? g.command : undefined,
        functionRef: "functionRef" in g ? g.functionRef : undefined,
        apiConfig: "apiConfig" in g ? g.apiConfig : undefined,
        timeoutMs: g.timeoutMs,
      });
      gateNameToId.set(g.name, gate.id);
    }

    // 2. Create flows, states, and transitions
    for (const f of parsed.flows) {
      const flow = await flowRepo.create({
        name: f.name,
        description: f.description,
        entitySchema: f.entitySchema,
        initialState: f.initialState,
        maxConcurrent: f.maxConcurrent,
        maxConcurrentPerRepo: f.maxConcurrentPerRepo,
        createdBy: f.createdBy,
      });

      const flowStates = parsed.states.filter((s) => s.flowName === f.name);
      for (const s of flowStates) {
        await flowRepo.addState(flow.id, {
          name: s.name,
          agentRole: s.agentRole,
          modelTier: s.modelTier,
          mode: s.mode,
          promptTemplate: s.promptTemplate,
          constraints: s.constraints,
        });
      }

      const flowTransitions = parsed.transitions.filter((t) => t.flowName === f.name);
      for (const t of flowTransitions) {
        if (t.gateName && !gateNameToId.has(t.gateName)) {
          throw new Error(
            `Transition from "${t.fromState}" to "${t.toState}" in flow "${f.name}" references unknown gate "${t.gateName}"`,
          );
        }
        await flowRepo.addTransition(flow.id, {
          fromState: t.fromState,
          toState: t.toState,
          trigger: t.trigger,
          gateId: t.gateName ? gateNameToId.get(t.gateName) : undefined,
          condition: t.condition,
          priority: t.priority,
          spawnFlow: t.spawnFlow,
          spawnTemplate: t.spawnTemplate,
        });
      }
    }

    // 3. Insert integrations
    for (const i of parsed.integrations) {
      await integrationRepo.create({
        capability: i.capability,
        adapter: i.adapter,
        config: i.config,
      });
    }

    sqlite.exec("COMMIT");
  } catch (err) {
    sqlite.exec("ROLLBACK");
    throw err;
  }

  return {
    flows: parsed.flows.length,
    gates: parsed.gates.length,
    integrations: parsed.integrations.length,
  };
}
