import type { Entity, Flow, OnExitConfig } from "../repositories/interfaces.js";

export interface OnExitResult {
  error: string | null;
  timedOut: boolean;
}

export async function executeOnExit(
  onExit: OnExitConfig,
  _entity: Entity,
  _flow?: Flow | null,
  _adapterRegistry?: null,
): Promise<OnExitResult> {
  const op = onExit.op;

  // Without an adapter registry, onExit ops cannot be executed.
  return { error: `AdapterRegistry not available for primitive onExit op "${op}"`, timedOut: false };
}
