const BEARER_PATTERN = /\bbearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const BASIC_PATTERN = /\bbasic\s+[A-Za-z0-9+/]+=*/gi;
const LINEAR_API_KEY_PATTERN = /lin_api_[A-Za-z0-9]+/g;
const GITHUB_TOKEN_PATTERN = /\b(ghp_|gho_|ghu_|ghr_|github_pat_)[A-Za-z0-9_]{36,}\b/g;
const KEY_VALUE_PATTERN = /((?:api[_-]?key|token|secret|password|authorization)\s*[=:]\s*["']?)[^\s"',}]+/gi;

export function sanitizeErrorMessage(msg: string): string {
  let result = msg;
  result = result.replace(BEARER_PATTERN, "Bearer [REDACTED]");
  result = result.replace(BASIC_PATTERN, "Basic [REDACTED]");
  result = result.replace(LINEAR_API_KEY_PATTERN, "[REDACTED]");
  result = result.replace(GITHUB_TOKEN_PATTERN, "[REDACTED]");
  result = result.replace(KEY_VALUE_PATTERN, "$1[REDACTED]");
  return result;
}

export function safeErrorMessage(err: unknown): string {
  if (err === null || err === undefined) return "unknown error";
  const msg = err instanceof Error ? err.message : String(err);
  return sanitizeErrorMessage(msg);
}
