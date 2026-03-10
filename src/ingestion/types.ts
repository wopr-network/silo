import { z } from "zod/v4";

export const IngestEventSchema = z.object({
  sourceId: z.string().min(1),
  externalId: z.string().min(1),
  type: z.enum(["new", "update"]),
  flowName: z.string().min(1),
  signal: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type IngestEvent = z.infer<typeof IngestEventSchema>;
