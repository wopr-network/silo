/**
 * Holyship tRPC root router.
 *
 * Composes platform-core routers (billing, profile, settings)
 * with holyship-specific routers (flow, entity, github).
 */

// biome-ignore lint/suspicious/noExplicitAny: tRPC types from platform-core
type Router = any;
// biome-ignore lint/suspicious/noExplicitAny: tRPC procedure builder
type Procedure = any;

import { createEntityRouter } from "./routers/entity.js";
import { createFlowRouter } from "./routers/flow.js";
import { createGithubRouter } from "./routers/github.js";

export function createAppRouter(router: Router, protectedProcedure: Procedure) {
  return router({
    flow: createFlowRouter(router, protectedProcedure),
    entity: createEntityRouter(router, protectedProcedure),
    github: createGithubRouter(router, protectedProcedure),
    // Platform-core routers (billing, profile, settings) are merged in boot.ts
  });
}

export { setEntityRouterDeps } from "./routers/entity.js";
export { setFlowRouterDeps } from "./routers/flow.js";
export { setGithubRouterDeps } from "./routers/github.js";
