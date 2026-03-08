import { z } from "zod/v4";
import { validateGateCommand } from "../engine/gate-command-validator.js";
import { validateTemplate } from "../engine/handlebars.js";

const safeTemplate = z.string().refine(validateTemplate, {
  message: "Template contains unsafe patterns (lookup, @root, __proto__, constructor)",
});

const AdminStateInlineSchema = z.object({
  name: z.string().min(1),
  modelTier: z.string().optional(),
  mode: z.enum(["passive", "active"]).optional(),
  promptTemplate: safeTemplate.optional(),
  constraints: z.record(z.string(), z.unknown()).optional(),
});

export const AdminFlowCreateSchema = z.object({
  name: z.string().min(1),
  initialState: z.string().min(1),
  discipline: z.string().min(1).optional(),
  defaultModelTier: z.string().min(1).optional(),
  description: z.string().optional(),
  entitySchema: z.record(z.string(), z.unknown()).optional(),
  maxConcurrent: z.number().int().min(0).optional(),
  maxConcurrentPerRepo: z.number().int().min(0).optional(),
  affinityWindowMs: z.number().int().min(0).optional(),
  gateTimeoutMs: z.number().int().min(0).optional(),
  createdBy: z.string().optional(),
  timeoutPrompt: safeTemplate.min(1).optional(),
  states: z.array(AdminStateInlineSchema).min(1, "Flow must have at least one state definition").optional(),
});

export const AdminFlowUpdateSchema = z.object({
  flow_name: z.string().min(1),
  description: z.string().optional(),
  discipline: z.string().min(1).nullable().optional(),
  defaultModelTier: z.string().min(1).nullable().optional(),
  maxConcurrent: z.number().int().min(0).optional(),
  maxConcurrentPerRepo: z.number().int().min(0).optional(),
  affinityWindowMs: z.number().int().min(0).optional(),
  gateTimeoutMs: z.number().int().min(0).optional(),
  initialState: z.string().min(1).optional(),
  timeoutPrompt: safeTemplate.min(1).nullable().optional(),
});

export const AdminStateCreateSchema = z.object({
  flow_name: z.string().min(1),
  name: z.string().min(1),
  modelTier: z.string().optional(),
  mode: z.enum(["passive", "active"]).optional(),
  promptTemplate: safeTemplate.optional(),
  constraints: z.record(z.string(), z.unknown()).optional(),
});

export const AdminStateUpdateSchema = z.object({
  flow_name: z.string().min(1),
  state_name: z.string().min(1),
  modelTier: z.string().optional(),
  mode: z.enum(["passive", "active"]).optional(),
  promptTemplate: safeTemplate.optional(),
  constraints: z.record(z.string(), z.unknown()).optional(),
});

export const AdminTransitionCreateSchema = z.object({
  flow_name: z.string().min(1),
  fromState: z.string().min(1),
  toState: z.string().min(1),
  trigger: z.string().min(1),
  gateName: z.string().min(1).optional(),
  condition: safeTemplate.optional(),
  priority: z.number().int().min(0).optional(),
  spawnFlow: z.string().optional(),
  spawnTemplate: safeTemplate.optional(),
});

export const AdminTransitionUpdateSchema = z.object({
  flow_name: z.string().min(1),
  transition_id: z.string().min(1),
  fromState: z.string().min(1).optional(),
  toState: z.string().min(1).optional(),
  trigger: z.string().min(1).optional(),
  gateName: z.string().min(1).optional(),
  condition: safeTemplate.nullable().optional(),
  priority: z.number().int().min(0).nullable().optional(),
  spawnFlow: z.string().nullable().optional(),
  spawnTemplate: safeTemplate.nullable().optional(),
});

export const AdminGateCreateSchema = z.discriminatedUnion("type", [
  z.object({
    name: z.string().min(1),
    type: z.literal("command"),
    command: z
      .string()
      .min(1)
      .superRefine((cmd, ctx) => {
        const result = validateGateCommand(cmd);
        if (!result.valid) {
          ctx.addIssue({ code: "custom", message: result.error ?? "Gate command not allowed" });
        }
      }),
    timeoutMs: z.number().int().min(0).optional(),
    failurePrompt: z.string().optional(),
    timeoutPrompt: z.string().optional(),
  }),
  z.object({
    name: z.string().min(1),
    type: z.literal("function"),
    functionRef: z.string().regex(/^[^:]+:[^:]+$/, "functionRef must be in 'path:exportName' format"),
    timeoutMs: z.number().int().min(0).optional(),
    failurePrompt: z.string().optional(),
    timeoutPrompt: z.string().optional(),
  }),
  z.object({
    name: z.string().min(1),
    type: z.literal("api"),
    apiConfig: z.record(z.string(), z.unknown()),
    timeoutMs: z.number().int().min(0).optional(),
    failurePrompt: z.string().optional(),
    timeoutPrompt: z.string().optional(),
  }),
]);

export const AdminGateAttachSchema = z.object({
  flow_name: z.string().min(1),
  transition_id: z.string().min(1),
  gate_name: z.string().min(1),
});

export const AdminFlowSnapshotSchema = z.object({
  flow_name: z.string().min(1),
});

export const AdminFlowRestoreSchema = z.object({
  flow_name: z.string().min(1),
  version: z.number().int().min(1),
});

export const AdminFlowPauseSchema = z.object({
  flow_name: z.string().min(1),
});

export const AdminEntityCancelSchema = z.object({
  entity_id: z.string().min(1),
});

export const AdminEntityResetSchema = z.object({
  entity_id: z.string().min(1),
  target_state: z.string().min(1),
});

export const AdminWorkerDrainSchema = z.object({
  worker_id: z.string().min(1),
});

export const AdminGateRerunSchema = z.object({
  entity_id: z.string().min(1),
  gate_name: z.string().min(1),
});
