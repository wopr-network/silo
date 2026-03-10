// Re-export worker pool tables from unified schema
export {
  entityActivity,
  entityMap,
  eventLog,
  sources,
  throughputEvents,
  watches,
  workers,
} from "../repositories/drizzle/schema.js";
