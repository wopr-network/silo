const REPO_LINE_PATTERN = /\*\*Repo:\*\*[^\S\n]+(.+)/;

export function extractReposFromDescription(description: string | null): string[] {
  if (!description) return [];
  const match = REPO_LINE_PATTERN.exec(description);
  if (!match) return [];
  return match[1]
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** @deprecated Use extractReposFromDescription instead. */
export function extractRepoFromDescription(description: string | null): string | null {
  const repos = extractReposFromDescription(description);
  return repos.length > 0 ? repos[0] : null;
}
