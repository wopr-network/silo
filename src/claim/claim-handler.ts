import type { DefconClient } from "../defcon-client/client.js";
import type { InMemoryWorkerRepo } from "../worker/worker-repo.js";
import type { ExternalClaimRequest, ExternalClaimResponse } from "./types.js";

export class ClaimHandler {
  constructor(
    private defcon: DefconClient,
    private workers: InMemoryWorkerRepo,
  ) {}

  async handle(req: ExternalClaimRequest): Promise<ExternalClaimResponse> {
    let workerId = req.worker_id;
    let notice: string | undefined;

    if (!workerId || !this.workers.get(workerId)) {
      const worker = this.workers.create({
        type: req.workerType,
        discipline: req.discipline,
      });
      workerId = worker.id;
      notice = `Your worker_id is ${workerId}. Include it in all subsequent calls.`;
    } else {
      this.workers.touch(workerId);
    }

    const claim = await this.defcon.claim({
      workerId,
      role: req.role,
      flow: req.flow,
    });

    const response: ExternalClaimResponse = {
      worker_id: workerId,
      claim,
    };
    if (notice) {
      response.worker_notice = notice;
    }
    return response;
  }
}
