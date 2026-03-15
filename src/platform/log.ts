import { createLogger, format, transports } from "winston";

export const log = createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});
