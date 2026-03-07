// Sensitive term must appear as a whole word component in camelCase/snake_case keys.
// Split on underscores and camelCase boundaries before matching, so e.g. "authHeader"
// is redacted (contains "auth" as a component) but "authorId" is not ("author" ≠ "auth").
const SENSITIVE_TERMS = new Set(["token", "key", "secret", "password", "bearer", "auth", "credential"]);
function isSensitiveKey(k: string): boolean {
  // Split on: underscores, spaces, or camelCase transitions (lower→upper, upper→upper+lower)
  const words = k.split(/[_\s]+|(?<=[a-z\d])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/);
  return words.some((w) => SENSITIVE_TERMS.has(w.toLowerCase()));
}
const DESCRIPTION_MAX = 100;

// Patterns to strip from string content
const CREDENTIAL_PATTERNS = [
  /Bearer\s+\S+/gi,
  /\bsk-ant-\S+/gi,
  /\bsk-\S{20,}/gi,
  /(?:password|secret|token|key|auth)[\s]*[=:]\s*\S+/gi,
];

export function redactString(value: string, maxLength = 500): string {
  let result = value;
  for (const pattern of CREDENTIAL_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  if (result.length > maxLength) {
    result = `${result.slice(0, maxLength)}...`;
  }
  return result;
}

export function redact(value: unknown): unknown {
  return walk(value, new WeakSet());
}

function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (value instanceof Error) {
    return walk({ name: value.name, message: value.message, stack: value.stack }, seen);
  }

  const obj = value as Record<string, unknown>;
  if (seen.has(obj)) return "[Circular]";
  seen.add(obj);

  if (Array.isArray(obj)) {
    return obj.map((item) => walk(item, seen));
  }

  const result: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];

    if (isSensitiveKey(k)) {
      result[k] = "[REDACTED]";
    } else if (k === "description" && typeof v === "string" && v.length > DESCRIPTION_MAX) {
      result[k] = `${v.slice(0, DESCRIPTION_MAX)}...`;
    } else {
      result[k] = walk(v, seen);
    }
  }
  return result;
}
