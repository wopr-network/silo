import type { HolyshipClient } from "../holyship-client/client.js";
import { type IngestEvent, IngestEventSchema } from "./types.js";

/** Minimal interface for the entity map repository. */
export interface IEntityMapRepository {
  insertIfAbsent(sourceId: string, externalId: string, entityId: string): Promise<boolean>;
  deleteRow(sourceId: string, externalId: string): Promise<void>;
  updateEntityId(sourceId: string, externalId: string, entityId: string): Promise<void>;
  findEntityId(sourceId: string, externalId: string): Promise<string | undefined>;
}

export class Ingestor {
  private entityMapRepo: IEntityMapRepository;
  private holyship: HolyshipClient;

  constructor(entityMapRepo: IEntityMapRepository, holyship: HolyshipClient) {
    this.entityMapRepo = entityMapRepo;
    this.holyship = holyship;
  }

  async ingest(raw: unknown): Promise<void> {
    const event = IngestEventSchema.parse(raw);

    if (event.type === "new") {
      await this.handleNew(event);
    } else {
      await this.handleUpdate(event);
    }
  }

  private async handleNew(event: IngestEvent): Promise<void> {
    // Insert a sentinel with a placeholder entityId before the async call.
    // Only the caller that wins the INSERT proceeds to createEntity;
    // concurrent callers see the conflict and bail out, preventing duplicate entities.
    const sentinel = "__pending__";
    const won = await this.entityMapRepo.insertIfAbsent(event.sourceId, event.externalId, sentinel);
    if (!won) {
      return;
    }

    let response: { id: string };
    try {
      response = await this.holyship.createEntity({
        flowName: event.flowName,
        ...(event.payload !== undefined ? { payload: event.payload } : {}),
      });
    } catch (err) {
      // Clean up the sentinel so future events can retry.
      await this.entityMapRepo.deleteRow(event.sourceId, event.externalId);
      throw err;
    }

    // Update the sentinel row to the real entityId.
    await this.entityMapRepo.updateEntityId(event.sourceId, event.externalId, response.id);

    // Fire the configured signal (e.g. "start") to advance the entity out of its initial state.
    if (event.signal) {
      await this.holyship.report({ entityId: response.id, signal: event.signal, artifacts: {} });
    }
  }

  private async handleUpdate(event: IngestEvent): Promise<void> {
    const entityId = await this.entityMapRepo.findEntityId(event.sourceId, event.externalId);
    if (entityId === undefined) {
      return;
    }
    if (entityId === "__pending__") {
      throw new Error(`Entity for ${event.sourceId}/${event.externalId} is still being created — retry later`);
    }

    await this.holyship.report({
      entityId,
      signal: event.signal ?? "update",
      artifacts: event.payload ?? {},
    });
  }
}
