import type { IngestEvent } from "../ingestion/types.js";
import type { Source, Watch } from "../radar-db/types.js";

export interface SourceAdapter {
  readonly type: string;
  parseEvent(payload: unknown, source: Source, watches: Watch[]): IngestEvent | null;
  verifySignature(
    rawBody: string,
    source: Source,
    headers: Record<string, string | string[] | undefined>,
  ): { valid: boolean; error?: string };
}

export class SourceAdapterRegistry {
  private adapters = new Map<string, SourceAdapter>();

  register(adapter: SourceAdapter): void {
    if (this.adapters.has(adapter.type)) {
      throw new Error(`Adapter for source type "${adapter.type}" is already registered`);
    }
    this.adapters.set(adapter.type, adapter);
  }

  get(type: string): SourceAdapter | undefined {
    return this.adapters.get(type);
  }

  has(type: string): boolean {
    return this.adapters.has(type);
  }
}
