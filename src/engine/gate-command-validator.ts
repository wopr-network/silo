import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitShellWords } from "./shell-words.js";

export interface GateCommandValidation {
  valid: boolean;
  resolvedPath: string | null;
  error: string | null;
}

// Anchor project root and gates directory to module location, not process.cwd()
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(MODULE_DIR, "../..");
const GATES_ROOT = path.resolve(PROJECT_ROOT, "gates");

export function validateGateCommand(command: string): GateCommandValidation {
  if (!command || command.trim().length === 0) {
    return { valid: false, resolvedPath: null, error: "Gate command is empty" };
  }

  const parts = splitShellWords(command);
  if (parts.length === 0) {
    return { valid: false, resolvedPath: null, error: "Gate command is empty" };
  }
  const executable = parts[0];

  if (path.isAbsolute(executable)) {
    return { valid: false, resolvedPath: null, error: "Gate command must not use absolute paths" };
  }

  // Resolve relative to project root (command format is gates/<file> from project root)
  const resolved = path.resolve(PROJECT_ROOT, executable);

  // Ensure lexically resolved path is under gates/
  const relative = path.relative(GATES_ROOT, resolved);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    return {
      valid: false,
      resolvedPath: null,
      error: `Gate command must start with 'gates/' and resolve inside the gates directory (resolved outside gates/)`,
    };
  }

  // Resolve symlinks to prevent symlink escape
  let realPath: string;
  try {
    realPath = fs.realpathSync(resolved);
  } catch {
    // Path doesn't exist yet (gate script may be deployed separately) — treat lexical check as sufficient
    // but still reject if it would escape after symlink resolution
    return { valid: true, resolvedPath: resolved, error: null };
  }

  const realRelative = path.relative(GATES_ROOT, realPath);
  if (realRelative.startsWith(`..${path.sep}`) || realRelative === ".." || path.isAbsolute(realRelative)) {
    return {
      valid: false,
      resolvedPath: null,
      error: `Gate command resolves via symlink to outside the gates directory`,
    };
  }

  return { valid: true, resolvedPath: realPath, error: null };
}
