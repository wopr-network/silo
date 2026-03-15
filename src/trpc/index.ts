/**
 * Root tRPC router composing flow, entity, and github sub-routers.
 *
 * Note: This module uses a minimal tRPC-like pattern. When @trpc/server is
 * added as a dependency, swap to the real initTRPC.create() call.
 */

import { entityRouter } from "./routers/entity.js";
import { flowRouter } from "./routers/flow.js";
import { githubRouter } from "./routers/github.js";

export { flowRouter, entityRouter, githubRouter };

/** Compose all routers into a single appRouter shape. */
export function createAppRouter() {
  return {
    flow: flowRouter,
    entity: entityRouter,
    github: githubRouter,
  };
}

export type AppRouter = ReturnType<typeof createAppRouter>;
