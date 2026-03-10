import { accessSync, constants } from "node:fs";
import { dirname } from "node:path";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

export interface Logger {
  error(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

export const consoleLogger: Logger = {
  error: (msg, ...args) => console.error(msg, ...args),
  warn: (msg, ...args) => console.warn(msg, ...args),
  info: (msg, ...args) => console.info(msg, ...args),
  debug: (msg, ...args) => console.debug(msg, ...args),
};

export const noopLogger: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

const logFile = process.env.SILO_LOG_FILE ?? "/data/silo.log";

const consoleTransport = new winston.transports.Console({
  stderrLevels: ["error", "warn", "info", "http", "verbose", "debug", "silly"],
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      let metaStr = "";
      if (Object.keys(meta).length) {
        try {
          metaStr = ` ${JSON.stringify(meta)}`;
        } catch {
          metaStr = ` [unserializable meta]`;
        }
      }
      return `${String(timestamp)} ${level}: ${String(message)}${metaStr}`;
    }),
  ),
});

const transports: winston.transport[] = [consoleTransport];

try {
  accessSync(dirname(logFile), constants.W_OK);
  const fileTransport = new DailyRotateFile({
    filename: logFile,
    datePattern: "YYYY-MM-DD",
    maxFiles: "7d",
    maxSize: "50m",
  });
  fileTransport.on("error", (_err: Error) => {});
  transports.push(fileTransport);
} catch {
  // Log directory not writable — console-only logging
}

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports,
});
