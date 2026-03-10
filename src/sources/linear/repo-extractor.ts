const REPO_PATTERN = /\*\*Repo:\*\*[^\S\n]+(\S+)/;

export function extractRepoFromDescription(description: string | null): string | null {
  if (!description) return null;
  const match = REPO_PATTERN.exec(description);
  return match ? match[1] : null;
}
