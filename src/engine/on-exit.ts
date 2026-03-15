import type { Entity, Flow, OnExitConfig } from "../repositories/interfaces.js";

export interface OnExitResult {
  error: string | null;
  timedOut: boolean;
}

export async function executeOnExit(
  _onExit: OnExitConfig,
  _entity: Entity,
  _flow?: Flow | null,
  _adapterRegistry?: null,
): Promise<OnExitResult> {
  return { error: "Primitive onExit ops not yet implemented (integration adapter layer removed)", timedOut: false };
}
