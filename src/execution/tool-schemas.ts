import { z } from "zod/v4";

export const FlowClaimSchema = z.object({
  role: z.string().min(1),
  flow: z.string().min(1).optional(),
});

export const FlowGetPromptSchema = z.object({
  entity_id: z.string().min(1),
});

export const FlowReportSchema = z.object({
  entity_id: z.string().min(1),
  signal: z.string().min(1),
  artifacts: z.record(z.string(), z.unknown()).optional(),
});

export const FlowFailSchema = z.object({
  entity_id: z.string().min(1),
  error: z.string().min(1),
});

export const QueryEntitySchema = z.object({
  id: z.string().min(1),
});

export const QueryEntitiesSchema = z.object({
  flow: z.string().min(1),
  state: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional(),
});

export const QueryInvocationsSchema = z.object({
  entity_id: z.string().min(1),
});

export const QueryFlowSchema = z.object({
  name: z.string().min(1),
});
