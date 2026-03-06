/** Match a dot-separated event pattern against an event type.
 *  `*` matches exactly one segment. */
export function matchEventPattern(pattern: string, eventType: string): boolean {
  const patternParts = pattern.split(".");
  const eventParts = eventType.split(".");
  if (patternParts.length !== eventParts.length) return false;
  return patternParts.every((p, i) => p === "*" || p === eventParts[i]);
}
