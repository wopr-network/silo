const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export interface CorsOriginResult {
  /** Explicit allowed origins, or null meaning "loopback-only default pattern" */
  origins: string[] | null;
}

export function resolveCorsOrigin(opts: { host: string; corsEnv: string | undefined }): CorsOriginResult {
  const corsValue = opts.corsEnv?.trim() || undefined;
  const isLoopback = LOOPBACK_HOSTS.has(opts.host);

  // If explicit origins provided, validate each and use them
  if (corsValue) {
    const entries = corsValue
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const entry of entries) {
      if (!/^https?:\/\/[^/]+$/.test(entry)) {
        throw new Error(
          `DEFCON_CORS_ORIGIN must be bare origins like https://app.example.com (comma-separated for multiple), not ${entry}. ` +
            "Remove any path component or trailing slash.",
        );
      }
    }
    return { origins: entries };
  }

  // Non-loopback without explicit origin — refuse to start
  if (!isLoopback) {
    throw new Error(
      `DEFCON_CORS_ORIGIN must be set when binding to non-loopback address "${opts.host}". ` +
        "Without an explicit CORS origin, any website on the network can make cross-origin requests to this server. " +
        'Set DEFCON_CORS_ORIGIN to the allowed origin (e.g. "https://my-app.example.com") or use a loopback address. ' +
        "Multiple origins can be separated by commas.",
    );
  }

  // Loopback without explicit origin — use default pattern
  return { origins: null };
}
