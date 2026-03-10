import type { Db } from "../main.js";

export type RadarDb = Db;

/**
 * Re-export for backward compatibility.
 * In the Postgres world, callers should use `bootstrap()` from `../main.js` instead.
 * This module no longer creates its own database — all repos accept the shared Db instance.
 */
