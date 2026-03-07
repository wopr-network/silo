import path from "node:path";
import { realpathSync } from "node:fs";

export interface GateCommandValidation {
  valid: boolean;
  resolvedPath: string | null;
  error: string | null;
}

const GATES_DIR = "gates";

export function validateGateCommand(command: string): GateCommandValidation {
  if (!command || command.trim().length === 0) {
    return { valid: false, resolvedPath: null, error: "Gate command is empty" };
  }

  const executable = command.split(/\s+/)[0];

  if (path.isAbsolute(executable)) {
    return { valid: false, resolvedPath: null, error: "Gate command must not use absolute paths" };
  }

  // Resolve relative to project root (cwd) — string-only, may still contain symlinks
  const resolved = path.resolve(executable);
  const gatesRoot = path.resolve(GATES_DIR);

  // String-based pre-check before stat
  const preRelative = path.relative(gatesRoot, resolved);
  if (preRelative.startsWith("..") || path.isAbsolute(preRelative)) {
    return {
      valid: false,
      resolvedPath: null,
      error: `Gate command must start with 'gates/' and resolve inside the gates directory (resolved outside gates/)`,
    };
  }

  // Follow symlinks to prevent symlink escape (e.g. gates/evil -> /etc/passwd)
  let realPath: string;
  try {
    realPath = realpathSync(resolved);
  } catch {
    return { valid: false, resolvedPath: null, error: "Gate command path does not exist" };
  }

  let realGatesRoot: string;
  try {
    realGatesRoot = realpathSync(gatesRoot);
  } catch {
    return { valid: false, resolvedPath: null, error: "Gates directory does not exist" };
  }

  const relative = path.relative(realGatesRoot, realPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return {
      valid: false,
      resolvedPath: null,
      error: `Gate command must start with 'gates/' and resolve inside the gates directory (resolved outside gates/)`,
    };
  }

  return { valid: true, resolvedPath: realPath, error: null };
}
