import type { Slot, SlotState, WorkerResult } from "./types.js";

export class Pool {
  private slots: Map<string, Slot> = new Map();
  private capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  allocate(
    slotId: string,
    workerId: string,
    discipline: string,
    entityId: string,
    prompt: string,
    flowName: string | null = null,
    repo: string | null = null,
  ): Slot | null {
    if (this.slots.has(slotId)) throw new Error(`Slot already allocated: ${slotId}`);
    if (this.slots.size >= this.capacity) return null;
    const slot: Slot = {
      slotId,
      workerId,
      discipline,
      entityId,
      state: "claimed",
      prompt,
      result: null,
      flowName,
      repo,
      lastHeartbeat: Date.now(),
    };
    this.slots.set(slotId, slot);
    return slot;
  }

  heartbeat(slotId: string): void {
    const slot = this.slots.get(slotId);
    if (slot) {
      slot.lastHeartbeat = Date.now();
    }
  }

  complete(slotId: string, result: WorkerResult): void {
    const slot = this.slots.get(slotId);
    if (!slot) throw new Error(`Unknown slot: ${slotId}`);
    slot.result = result;
    slot.state = "reporting";
    slot.lastHeartbeat = Date.now();
  }

  release(slotId: string): void {
    if (!this.slots.has(slotId)) throw new Error(`Unknown slot: ${slotId}`);
    this.slots.delete(slotId);
  }

  setState(slotId: string, state: SlotState): void {
    const slot = this.slots.get(slotId);
    if (!slot) throw new Error(`Unknown slot: ${slotId}`);
    slot.state = state;
  }

  getCapacity(): number {
    return this.capacity;
  }

  availableSlots(): number {
    return Math.max(0, this.capacity - this.slots.size);
  }

  activeSlots(): Slot[] {
    return Array.from(this.slots.values());
  }

  activeCountByFlow(flowName: string): number {
    let count = 0;
    for (const slot of this.slots.values()) {
      if (slot.flowName === flowName) count++;
    }
    return count;
  }

  activeCountByRepo(flowName: string, repo: string): number {
    let count = 0;
    for (const slot of this.slots.values()) {
      if (slot.flowName === flowName && slot.repo === repo) count++;
    }
    return count;
  }
}
