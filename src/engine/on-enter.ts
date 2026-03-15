import type { Entity, Flow, IEntityRepository, OnEnterConfig } from "../repositories/interfaces.js";

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
  _flow?: Flow | null,
  _adapterRegistry?: null,
): Promise<OnEnterResult> {
  // Idempotency: skip if all named artifacts already present
  const existingArtifacts = entity.artifacts ?? {};
  const allPresent = onEnter.artifacts.every((key) => existingArtifacts[key] !== undefined);
  if (allPresent) {
    return { skipped: true, artifacts: null, error: null, timedOut: false };
  }

  const error = "Primitive onEnter ops not yet implemented (integration adapter layer removed)";
  await entityRepo.updateArtifacts(entity.id, { onEnter_error: { op: onEnter.op, error } });
  return { skipped: false, artifacts: null, error, timedOut: false };
}
