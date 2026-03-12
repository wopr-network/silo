import type { AdapterRegistry } from "../integrations/registry.js";
import type { PrimitiveOp } from "../integrations/types.js";
import { opCategory } from "../integrations/types.js";
import type { Entity, Flow, IEntityRepository, OnEnterConfig } from "../repositories/interfaces.js";
import { getHandlebars } from "./handlebars.js";

export interface OnEnterResult {
  skipped: boolean;
  artifacts: Record<string, unknown> | null;
  error: string | null;
  timedOut: boolean;
}

export async function executeOnEnter(
  onEnter: OnEnterConfig,
  entity: Entity,
  entityRepo: IEntityRepository,
  flow?: Flow | null,
  adapterRegistry?: AdapterRegistry | null,
): Promise<OnEnterResult> {
  // Idempotency: skip if all named artifacts already present
  const existingArtifacts = entity.artifacts ?? {};
  const allPresent = onEnter.artifacts.every((key) => existingArtifacts[key] !== undefined);
  if (allPresent) {
    return { skipped: true, artifacts: null, error: null, timedOut: false };
  }

  const op = onEnter.op as PrimitiveOp;

  if (!adapterRegistry) {
    const error = "AdapterRegistry not available for primitive onEnter op";
    await entityRepo.updateArtifacts(entity.id, { onEnter_error: { op, error } });
    return { skipped: false, artifacts: null, error, timedOut: false };
  }

  const category = opCategory(op);
  const integrationId = category === "issue_tracker" ? flow?.issueTrackerIntegrationId : flow?.vcsIntegrationId;

  if (!integrationId) {
    const error = `Flow has no ${category} integration configured`;
    await entityRepo.updateArtifacts(entity.id, { onEnter_error: { op, error } });
    return { skipped: false, artifacts: null, error, timedOut: false };
  }

  // Render params via Handlebars
  const hbs = getHandlebars();
  const artifactRefs =
    entity.artifacts !== null &&
    typeof entity.artifacts === "object" &&
    "refs" in entity.artifacts &&
    entity.artifacts.refs !== null &&
    typeof entity.artifacts.refs === "object"
      ? (entity.artifacts.refs as Record<string, unknown>)
      : {};
  const entityForContext = { ...entity, refs: { ...artifactRefs, ...(entity.refs ?? {}) } };

  let renderedParams: Record<string, unknown>;
  try {
    const rawParams = onEnter.params ?? {};
    renderedParams = Object.fromEntries(
      Object.entries(rawParams).map(([k, v]) => [
        k,
        typeof v === "string" ? hbs.compile(v)({ entity: entityForContext }) : v,
      ]),
    );
  } catch (err) {
    const error = `onEnter template error: ${err instanceof Error ? err.message : String(err)}`;
    await entityRepo.updateArtifacts(entity.id, { onEnter_error: { op, error } });
    return { skipped: false, artifacts: null, error, timedOut: false };
  }

  // Execute primitive op with AbortSignal timeout
  const timeoutMs = onEnter.timeout_ms ?? 30000;
  let opResult: Record<string, unknown>;
  try {
    opResult = await adapterRegistry.execute(integrationId, op, renderedParams, AbortSignal.timeout(timeoutMs));
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      const error = `onEnter op timed out after ${timeoutMs}ms`;
      await entityRepo.updateArtifacts(entity.id, { onEnter_error: { op, error } });
      return { skipped: false, artifacts: null, error, timedOut: true };
    }
    const error = `onEnter op failed: ${err instanceof Error ? err.message : String(err)}`;
    await entityRepo.updateArtifacts(entity.id, { onEnter_error: { op, error } });
    return { skipped: false, artifacts: null, error, timedOut: false };
  }

  // Extract named artifact keys
  const missingKeys = onEnter.artifacts.filter((key) => opResult[key] === undefined);
  if (missingKeys.length > 0) {
    const error = `onEnter op missing expected artifact keys: ${missingKeys.join(", ")}`;
    await entityRepo.updateArtifacts(entity.id, { onEnter_error: { op, error } });
    return { skipped: false, artifacts: null, error, timedOut: false };
  }

  const mergedArtifacts: Record<string, unknown> = {};
  for (const key of onEnter.artifacts) {
    mergedArtifacts[key] = opResult[key];
  }

  await entityRepo.updateArtifacts(entity.id, mergedArtifacts);
  return { skipped: false, artifacts: mergedArtifacts, error: null, timedOut: false };
}
