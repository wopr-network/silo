/**
 * Repo Audit Prompt Template.
 *
 * Unlike interrogation (which runs once at onboarding to discover capabilities),
 * audits run continuously to find what's wrong RIGHT NOW — bugs, tech debt,
 * security issues, missing tests, stale deps.
 *
 * The audit is parameterized by which categories the user selects.
 * The output is a list of proposed issues ready for creation.
 */

export type AuditCategory = "code_quality" | "security" | "test_coverage" | "dependencies" | "tech_debt";

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  code_quality: "Code Quality",
  security: "Security",
  test_coverage: "Test Coverage",
  dependencies: "Dependencies",
  tech_debt: "Tech Debt",
};

export const AUDIT_CATEGORY_INSTRUCTIONS: Record<AuditCategory, string> = {
  code_quality: `## Code Quality Audit
Scan the codebase for quality issues that a senior engineer would flag in a review.

Look for:
- TODO, FIXME, HACK, XXX comments — each is a known problem someone deferred. Assess whether it's still relevant.
- Dead code — unused exports, unreachable branches, commented-out code blocks. Dead code is a maintenance trap.
- Large files (>400 lines) — they usually mean a module is doing too much. Identify what should be extracted.
- Copy-paste duplication — similar code in multiple places that should be a shared function.
- Inconsistent patterns — if most of the codebase does it one way but a few files do it differently, flag the outliers.
- Missing error handling — functions that can fail but don't handle the failure path.
- Poor naming — variables, functions, or files whose names don't match what they actually do.

For each finding, be specific: file path, line number or range, what's wrong, and what the fix looks like.`,

  security: `## Security Audit
Scan the codebase for security vulnerabilities that could be exploited.

Look for:
- Command injection — any use of exec(), execSync(), spawn() where arguments come from user input without validation.
- Path traversal — file operations (readFile, writeFile, readdir) where the path includes user-controlled segments without sanitization.
- SQL/NoSQL injection — raw queries with string interpolation instead of parameterized queries.
- Secrets in code — hardcoded API keys, tokens, passwords, or connection strings. Check for .env files that shouldn't be committed.
- Missing input validation — HTTP request bodies, query params, or message content used without schema validation.
- Insecure deserialization — JSON.parse on untrusted input without validation, eval(), new Function().
- Missing authentication/authorization — endpoints or operations that should require auth but don't check it.
- Prototype pollution — Object spread or assign from untrusted input without sanitization.
- Dependency vulnerabilities — known CVEs in dependencies (check package.json/lockfile versions against known advisories).

Rate each finding by exploitability: critical (exploitable now), high (exploitable with some effort), medium (theoretical risk), low (defense-in-depth).`,

  test_coverage: `## Test Coverage Audit
Identify code that lacks test coverage and where new tests would prevent the most regressions.

Look for:
- Source files with no corresponding test file — list every module in src/ that has no test in tests/.
- Complex functions with no tests — functions with multiple branches, error paths, or edge cases that aren't tested.
- Error paths never tested — catch blocks, fallback logic, timeout handlers, retry logic that only runs on failure.
- Integration boundaries — API endpoints, database queries, external service calls that need integration tests.
- Recent bug fixes without regression tests — if a bug was fixed but no test was added to prevent it from recurring.
- Flaky test indicators — tests with sleeps, hardcoded ports, or time-dependent assertions.
- Missing edge cases — functions that handle arrays but don't test empty arrays, functions that handle strings but don't test empty strings.

For each gap, describe what the test should verify and why that specific test matters (what regression it prevents).`,

  dependencies: `## Dependency Audit
Check the health of the project's dependency tree.

Look for:
- Outdated dependencies — major version bumps available, especially for frameworks and security-sensitive packages.
- Known vulnerabilities — CVEs in current dependency versions. Check npm audit or equivalent.
- Unused dependencies — packages in package.json/requirements.txt that no source file imports.
- Duplicate dependencies — different versions of the same package in the lockfile.
- Missing lockfile — if the project has a package.json but no lockfile, or the lockfile is out of date.
- Pinning issues — dependencies using ^ or ~ ranges that could break on minor/patch updates.
- Heavy dependencies — large packages imported for a single utility function that could be replaced.
- License issues — dependencies with incompatible licenses (GPL in an MIT project, etc.).

For each finding, include the current version, the recommended version, and what breaking changes to expect.`,

  tech_debt: `## Tech Debt Audit
Identify structural problems that slow down development and increase the cost of future changes.

Look for:
- God objects/modules — files or classes that do too many things and are touched by every PR.
- Missing types — any/unknown usage that should be properly typed, missing interfaces for module boundaries.
- Leaky abstractions — internal implementation details exposed in public APIs, tight coupling between modules.
- Configuration sprawl — hardcoded values that should be configurable, duplicate config across files.
- Missing abstractions — repeated patterns that should be a shared utility, interface, or base class.
- Obsolete patterns — code written for an older version of a framework that has a better modern API.
- Build/CI issues — slow builds, flaky CI steps, missing caching, unnecessary build steps.
- Documentation gaps — public APIs without docs, README that doesn't match current behavior, stale examples.
- Migration debt — database migrations that should be squashed, schema inconsistencies between code and DB.

For each finding, estimate the blast radius: how many files/modules are affected, and how much faster would development be if this were fixed.`,
};

export interface AuditConfig {
  categories: AuditCategory[];
  customInstructions?: string;
}

/**
 * Render the audit prompt with selected categories and custom instructions.
 */
export function renderAuditPrompt(repoFullName: string, config: AuditConfig): string {
  const categoryBlocks = config.categories.map((cat) => AUDIT_CATEGORY_INSTRUCTIONS[cat]).join("\n\n");

  const customBlock = config.customInstructions ? `\n\n## Additional Instructions\n${config.customInstructions}` : "";

  return `You are a repo auditor. Your job is to thoroughly scan this repository and produce a list of actionable issues.

## Repo
${repoFullName}

${categoryBlocks}${customBlock}

## Output Format

For each issue you find, output a line starting with \`ISSUE:\` followed by JSON:

ISSUE:{"category":"code_quality","title":"Extract auth middleware from server.ts","priority":"medium","file":"src/server.ts","line":145,"description":"server.ts is 680 lines. The auth middleware (lines 145-220) should be extracted to src/middleware/auth.ts. This file is touched by every PR and the auth logic is independent of the route handling."}

ISSUE:{"category":"security","title":"Command injection in deploy script","priority":"critical","file":"src/deploy.ts","line":34,"description":"exec() is called with unsanitized user input from the webhook payload. An attacker could inject shell commands via the branch name. Use execFile() with an arguments array instead of string interpolation."}

Rules for issues:
- **category** must be one of: code_quality, security, test_coverage, dependencies, tech_debt
- **priority** must be one of: critical, high, medium, low
- **file** should be the specific file path (or "project-wide" for cross-cutting issues)
- **line** is optional — include it when you can point to a specific line
- **title** should be actionable — start with a verb (Fix, Add, Extract, Remove, Replace, Update)
- **description** should be specific enough that a coder agent can act on it without further research. Include what's wrong, why it matters, and what the fix looks like.

Be thorough but not noisy. Only report issues worth fixing. A TODO that says "// TODO: nice to have someday" is not worth an issue. A TODO that says "// FIXME: this breaks on empty input" absolutely is.

When you're done, output on a line by itself:

audit_complete`;
}

export interface ProposedIssue {
  category: AuditCategory;
  title: string;
  priority: "critical" | "high" | "medium" | "low";
  file: string;
  line?: number;
  description: string;
}

/**
 * Parse the audit output into proposed issues.
 */
export function parseAuditOutput(output: string): ProposedIssue[] {
  const issues: ProposedIssue[] = [];

  for (const line of output.split("\n")) {
    if (line.startsWith("ISSUE:")) {
      const json = line.slice("ISSUE:".length).trim();
      try {
        const issue = JSON.parse(json) as ProposedIssue;
        if (issue.title && issue.category && issue.priority) {
          issues.push(issue);
        }
      } catch {
        // Skip malformed lines
      }
    }
  }

  return issues;
}
