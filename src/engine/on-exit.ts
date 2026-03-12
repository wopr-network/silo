import type { AdapterRegistry } from "../integrations/registry.js";
import type { PrimitiveOp } from "../integrations/types.js";
import { opCategory } from "../integrations/types.js";
import type { Entity, Flow, OnExitConfig } from "../repositories/interfaces.js";
import { getHandlebars } from "./handlebars.js";

export interface OnExitResult {
  error: string | null;
  timedOut: boolean;
}

export async function executeOnExit(
  onExit: OnExitConfig,
  entity: Entity,
  flow?: Flow | null,
  adapterRegistry?: AdapterRegistry | null,
): Promise<OnExitResult> {
  const op = onExit.op as PrimitiveOp;

  if (!adapterRegistry) {
    return { error: "AdapterRegistry not available for primitive onExit op", timedOut: false };
  }

  const category = opCategory(op);
  const integrationId = category === "issue_tracker" ? flow?.issueTrackerIntegrationId : flow?.vcsIntegrationId;

  if (!integrationId) {
    return { error: `Flow has no ${category} integration configured`, timedOut: false };
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
    const rawParams = onExit.params ?? {};
    renderedParams = Object.fromEntries(
      Object.entries(rawParams).map(([k, v]) => [
        k,
        typeof v === "string" ? hbs.compile(v)({ entity: entityForContext }) : v,
      ]),
    );
  } catch (err) {
    return { error: `onExit template error: ${err instanceof Error ? err.message : String(err)}`, timedOut: false };
  }

  // Execute primitive op with AbortSignal timeout
  const timeoutMs = onExit.timeout_ms ?? 30000;
  try {
    await adapterRegistry.execute(integrationId, op, renderedParams, AbortSignal.timeout(timeoutMs));
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return { error: `onExit op timed out after ${timeoutMs}ms`, timedOut: true };
    }
    return { error: `onExit op failed: ${err instanceof Error ? err.message : String(err)}`, timedOut: false };
  }

  return { error: null, timedOut: false };
}
