import { z } from "zod/v4";
import type { IngestEvent } from "../../ingestion/types.js";
import { extractReposFromDescription } from "./repo-extractor.js";

export interface WebhookWatchConfig {
  sourceId: string;
  flowName: string;
  signal?: string;
  filter: { state?: string; labels?: string[]; stateId?: string; labelIds?: string[] };
}

const LinearWebhookPayloadSchema = z.object({
  action: z.enum(["create", "update", "remove"]),
  type: z.string(),
  data: z.object({
    id: z.string().min(1),
    identifier: z.string().min(1),
    title: z.string().min(1),
    description: z.string().nullable().optional(),
    // Nested-object format (used in some contexts)
    state: z.object({ name: z.string().min(1), type: z.string().min(1) }).optional(),
    labels: z.array(z.object({ name: z.string().min(1) })).optional(),
    // Flat ID format (real Linear webhook payloads)
    stateId: z.string().min(1).optional(),
    labelIds: z.array(z.string().min(1)).optional(),
  }),
});

export function handleLinearWebhook(payload: unknown, watch: WebhookWatchConfig): IngestEvent | null {
  const parsed = LinearWebhookPayloadSchema.safeParse(payload);
  if (!parsed.success) return null;

  const p = parsed.data;

  if (p.type !== "Issue") return null;

  // Only process create/update events; "remove" means the issue was deleted or left the state.
  if (p.action === "remove") return null;

  const data = p.data;

  // Filter by stateId (flat ID format from real webhooks)
  if (watch.filter.stateId && data.stateId !== watch.filter.stateId) return null;

  // Filter by state name (nested-object format)
  if (watch.filter.state && data.state?.name !== watch.filter.state) return null;

  // Filter by labelIds (flat ID format from real webhooks)
  if (watch.filter.labelIds && watch.filter.labelIds.length > 0) {
    const issueLabels = new Set(data.labelIds ?? []);
    if (!watch.filter.labelIds.some((id) => issueLabels.has(id))) return null;
  }

  // Filter by label names (nested-object format)
  if (watch.filter.labels && watch.filter.labels.length > 0) {
    const issueLabels = new Set((data.labels ?? []).map((l) => l.name));
    if (!watch.filter.labels.some((l) => issueLabels.has(l))) return null;
  }

  const description = data.description ?? null;
  const repos = extractReposFromDescription(description);

  // Map watch action to the flow signal that should fire after entity creation.
  // e.g. "issue.started" → "start" fires the backlog→architecting transition.
  const signal = watch.signal ?? undefined;

  return {
    sourceId: watch.sourceId,
    externalId: data.id,
    type: "new",
    flowName: watch.flowName,
    signal,
    payload: {
      repos,
      refs: {
        linear: {
          id: data.id,
          key: data.identifier,
          title: data.title,
          description,
        },
        // Backwards compat: existing templates reference {{entity.artifacts.refs.github.repo}}.
        // New code should use payload.repos. This will be removed once templates are migrated.
        github: { repo: repos[0] ?? null },
      },
    },
  };
}
