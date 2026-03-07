const ENV_REF_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)}/g;

function resolveString(value: string): string {
  return value.replace(ENV_REF_PATTERN, (_match, varName: string) => {
    const envValue = process.env[varName];
    if (envValue === undefined) {
      throw new Error(`Environment variable "${varName}" is not set (referenced in integration config)`);
    }
    return envValue;
  });
}

function resolveValue(value: unknown): unknown {
  if (typeof value === "string") {
    return resolveString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item));
  }
  if (typeof value === "object" && value !== null) {
    return resolveRecord(value as Record<string, unknown>);
  }
  return value;
}

function resolveRecord(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    result[key] = resolveValue(val);
  }
  return result;
}

export function resolveConfigSecrets(config: Record<string, unknown> | null): Record<string, unknown> | null {
  if (config === null) return null;
  return resolveRecord(config);
}
