/**
 * Database type compatible with both postgres-js and PGlite drizzle drivers.
 * Both share the same query API, so we use a structural type.
 */
// biome-ignore lint/suspicious/noExplicitAny: cross-driver compatibility
export type Db = any;
