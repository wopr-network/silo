import { z } from "zod/v4";

// ─── Leaf Schemas ───

export const FlowDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  entitySchema: z.record(z.string(), z.unknown()).optional(),
  initialState: z.string().min(1),
  maxConcurrent: z.number().int().min(0).optional().default(0),
  maxConcurrentPerRepo: z.number().int().min(0).optional().default(0),
  version: z.number().int().min(1).optional().default(1),
  createdBy: z.string().optional(),
});

export const StateDefinitionSchema = z.object({
  name: z.string().min(1),
  flowName: z.string().min(1),
  agentRole: z.string().optional(),
  modelTier: z.string().optional(),
  mode: z.enum(["passive", "active"]).optional().default("passive"),
  promptTemplate: z.string().optional(),
  constraints: z.record(z.string(), z.unknown()).optional(),
});

// Gate: discriminated union on `type`
const BaseGateSchema = z.object({
  name: z.string().min(1),
  timeoutMs: z.number().int().min(0).optional().default(30000),
});

export const CommandGateSchema = BaseGateSchema.extend({
  type: z.literal("command"),
  command: z.string().min(1),
});

export const FunctionGateSchema = BaseGateSchema.extend({
  type: z.literal("function"),
  functionRef: z.string().min(1),
});

export const ApiGateSchema = BaseGateSchema.extend({
  type: z.literal("api"),
  apiConfig: z.record(z.string(), z.unknown()),
});

export const GateDefinitionSchema = z.discriminatedUnion("type", [
  CommandGateSchema,
  FunctionGateSchema,
  ApiGateSchema,
]);

export const TransitionRuleSchema = z.object({
  flowName: z.string().min(1),
  fromState: z.string().min(1),
  toState: z.string().min(1),
  trigger: z.string().min(1),
  gateName: z.string().optional(),
  condition: z.string().optional(),
  priority: z.number().int().min(0).optional().default(0),
  spawnFlow: z.string().optional(),
  spawnTemplate: z.string().optional(),
});

export const IntegrationConfigSchema = z.object({
  capability: z.string().min(1),
  adapter: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
});

// ─── Seed File Schema (with cross-reference validation) ───

export const SeedFileSchema = z
  .object({
    flows: z.array(FlowDefinitionSchema).min(1),
    states: z.array(StateDefinitionSchema).min(1),
    gates: z.array(GateDefinitionSchema).optional().default([]),
    transitions: z.array(TransitionRuleSchema).min(1),
    integrations: z.array(IntegrationConfigSchema).optional().default([]),
  })
  .superRefine((seed, ctx) => {
    // Bug 2 fix: detect duplicate flow names explicitly before building the Set
    const flowNames = new Set<string>();
    for (let i = 0; i < seed.flows.length; i++) {
      const name = seed.flows[i].name;
      if (flowNames.has(name)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate flow name "${name}"`,
          path: ["flows", i, "name"],
        });
      } else {
        flowNames.add(name);
      }
    }

    // Bug 2 fix: detect duplicate gate names explicitly before building the Set
    const gateNames = new Set<string>();
    for (let i = 0; i < seed.gates.length; i++) {
      const name = seed.gates[i].name;
      if (gateNames.has(name)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate gate name "${name}"`,
          path: ["gates", i, "name"],
        });
      } else {
        gateNames.add(name);
      }
    }

    // Detect duplicate integration capabilities
    const integrationCapabilities = new Set<string>();
    for (let i = 0; i < seed.integrations.length; i++) {
      const cap = seed.integrations[i].capability;
      if (integrationCapabilities.has(cap)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate integration capability: ${cap}`,
          path: ["integrations", i, "capability"],
        });
      } else {
        integrationCapabilities.add(cap);
      }
    }

    // Detect duplicate state names within a flow
    const stateNamesByFlow = new Map<string, Set<string>>();
    for (let i = 0; i < seed.states.length; i++) {
      const s = seed.states[i];
      if (!stateNamesByFlow.has(s.flowName)) {
        stateNamesByFlow.set(s.flowName, new Set());
      }
      const seen = stateNamesByFlow.get(s.flowName);
      if (seen?.has(s.name)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate state name '${s.name}' in flow '${s.flowName}'`,
          path: ["states", i, "name"],
        });
      } else {
        seen?.add(s.name);
      }
    }

    // Bug 1 fix: only populate statesByFlow for flows that actually exist,
    // so that transitions referencing unknown flows don't find stale state data.
    const statesByFlow = new Map<string, Set<string>>();
    for (const s of seed.states) {
      if (!flowNames.has(s.flowName)) continue;
      if (!statesByFlow.has(s.flowName)) {
        statesByFlow.set(s.flowName, new Set());
      }
      statesByFlow.get(s.flowName)?.add(s.name);
    }

    // Validate states reference existing flows
    for (let i = 0; i < seed.states.length; i++) {
      const s = seed.states[i];
      if (!flowNames.has(s.flowName)) {
        ctx.addIssue({
          code: "custom",
          message: `State "${s.name}" references unknown flow "${s.flowName}"`,
          path: ["states", i, "flowName"],
        });
      }
    }

    // Validate each flow's initialState is a defined state
    for (let i = 0; i < seed.flows.length; i++) {
      const f = seed.flows[i];
      const flowStates = statesByFlow.get(f.name);
      if (!flowStates || !flowStates.has(f.initialState)) {
        ctx.addIssue({
          code: "custom",
          message: `Flow "${f.name}" has initialState "${f.initialState}" which is not a defined state`,
          path: ["flows", i, "initialState"],
        });
      }
    }

    // Validate transitions
    for (let i = 0; i < seed.transitions.length; i++) {
      const t = seed.transitions[i];
      if (!flowNames.has(t.flowName)) {
        ctx.addIssue({
          code: "custom",
          message: `Transition references unknown flow "${t.flowName}"`,
          path: ["transitions", i, "flowName"],
        });
      } else {
        // Bug 3 fix: flow exists — check fromState/toState even if the flow has
        // zero states (statesByFlow entry will be missing or empty in that case).
        const flowStates = statesByFlow.get(t.flowName) ?? new Set<string>();
        if (!flowStates.has(t.fromState)) {
          ctx.addIssue({
            code: "custom",
            message: `Transition fromState "${t.fromState}" not defined in flow "${t.flowName}"`,
            path: ["transitions", i, "fromState"],
          });
        }
        if (!flowStates.has(t.toState)) {
          ctx.addIssue({
            code: "custom",
            message: `Transition toState "${t.toState}" not defined in flow "${t.flowName}"`,
            path: ["transitions", i, "toState"],
          });
        }
      }
      if (t.gateName && !gateNames.has(t.gateName)) {
        ctx.addIssue({
          code: "custom",
          message: `Transition references unknown gate "${t.gateName}"`,
          path: ["transitions", i, "gateName"],
        });
      }
      if (t.spawnFlow && !flowNames.has(t.spawnFlow)) {
        ctx.addIssue({
          code: "custom",
          message: `Transition spawnFlow "${t.spawnFlow}" references unknown flow`,
          path: ["transitions", i, "spawnFlow"],
        });
      }
    }
  });

// ─── Inferred Types ───

export type FlowDefinition = z.infer<typeof FlowDefinitionSchema>;
export type StateDefinition = z.infer<typeof StateDefinitionSchema>;
export type GateDefinition = z.infer<typeof GateDefinitionSchema>;
export type TransitionRule = z.infer<typeof TransitionRuleSchema>;
export type IntegrationConfig = z.infer<typeof IntegrationConfigSchema>;
export type SeedFile = z.infer<typeof SeedFileSchema>;
