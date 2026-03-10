import { readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import type { Db } from "../main.js";
import type { IFlowRepository, IGateRepository } from "../repositories/interfaces.js";
import { SeedFileSchema } from "./zod-schemas.js";

export interface LoadSeedOptions {
  allowedRoot?: string;
  db?: Db;
}

export interface LoadSeedResult {
  flows: number;
  gates: number;
}

export async function loadSeed(
  seedPath: string,
  flowRepo: IFlowRepository,
  gateRepo: IGateRepository,
  options?: LoadSeedOptions,
): Promise<LoadSeedResult> {
  const allowedRoot = options?.allowedRoot ?? process.cwd();
  const resolvedRoot = resolve(allowedRoot);
  const resolvedSeed = resolve(seedPath);

  const lexicalRel = relative(resolvedRoot, resolvedSeed);
  if (lexicalRel === ".." || lexicalRel.startsWith(`..${sep}`)) {
    throw new Error(`Seed path escapes allowed root: ${resolvedSeed} is not under ${resolvedRoot}`);
  }

  let realSeed: string;
  try {
    realSeed = realpathSync(resolvedSeed);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // File doesn't exist — let readFileSync throw its normal ENOENT error
      readFileSync(resolvedSeed, "utf-8");
      throw err; // unreachable, but satisfies TypeScript
    }
    throw err;
  }

  let realRoot: string;
  try {
    realRoot = realpathSync(resolvedRoot);
  } catch {
    realRoot = resolvedRoot;
  }

  const realRel = relative(realRoot, realSeed);
  if (realRel === ".." || realRel.startsWith(`..${sep}`)) {
    throw new Error(`Seed path escapes allowed root: resolved symlink ${realSeed} is not under ${realRoot}`);
  }

  const raw = readFileSync(realSeed, "utf-8");
  return parseSeedAndLoad(parseJson(raw, realSeed), flowRepo, gateRepo, options?.db);
}

function parseJson(raw: string, path: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid JSON in seed file: ${path}: ${msg}`, { cause: e });
  }
}

async function parseSeedAndLoad(
  json: unknown,
  flowRepo: IFlowRepository,
  gateRepo: IGateRepository,
  db?: Db,
): Promise<LoadSeedResult> {
  const parsed = SeedFileSchema.parse(json);

  const doLoad = async () => {
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
        failurePrompt: g.failurePrompt,
        timeoutPrompt: g.timeoutPrompt,
        outcomes: g.outcomes,
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
        claimRetryAfterMs: f.claimRetryAfterMs,
        gateTimeoutMs: f.gateTimeoutMs,
        createdBy: f.createdBy,
        discipline: f.discipline,
        defaultModelTier: f.defaultModelTier,
        timeoutPrompt: f.timeoutPrompt,
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
          onEnter: s.onEnter,
          onExit: s.onExit,
          retryAfterMs: s.retryAfterMs,
          meta: s.meta,
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

    return {
      flows: parsed.flows.length,
      gates: parsed.gates.length,
    };
  };

  // Wrap in a Postgres transaction if db is provided
  if (db) {
    return db.transaction(async () => doLoad());
  }
  return doLoad();
}
