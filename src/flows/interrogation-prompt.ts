/**
 * Repo Interrogation Prompt Template.
 *
 * Dispatched to a runner when a repo is onboarded. The AI inspects the repo,
 * produces a structured RepoConfig, identifies gaps, and bootstraps a CLAUDE.md.
 *
 * This is not a flow state — it's a one-shot dispatch that runs before any flow exists.
 * The output drives which flow gets designed for this repo.
 */

export const INTERROGATION_PROMPT = `You are a repo analyst. Your job is to thoroughly inspect this repository and produce a structured capabilities report.

## Repo
{{repoFullName}}

## Phase 1: File Inspection

Scan the repo for the following. Be thorough — check root and subdirectories.

**Structure:**
- Is this a monorepo? Check for: pnpm-workspace.yaml, lerna.json, nx.json, turbo.json, workspaces in package.json
- If monorepo, list each package/workspace and what it does
- What languages are used? Check file extensions and config files

**Package Manager:**
- Which lockfile exists? (pnpm-lock.yaml, package-lock.json, yarn.lock, Cargo.lock, go.sum, poetry.lock, requirements.txt)

**Testing:**
- Are there test files? Where? (look for *.test.*, *.spec.*, test/, tests/, __tests__/)
- What framework? (vitest.config.*, jest.config.*, pytest.ini, pyproject.toml [pytest section])
- Is coverage configured? What thresholds?
- What command runs the tests? (check package.json scripts, Makefile, etc.)

**CI/CD:**
- Is there CI? Check .github/workflows/, .circleci/, Jenkinsfile, .gitlab-ci.yml, bitbucket-pipelines.yml
- What checks run? (lint, build, test, security, etc.)
- Is there a merge queue configured?
- What are the required status checks?

**Code Quality:**
- Linter? (biome.json, .eslintrc*, ruff.toml, .golangci.yml, .rubocop.yml)
- Formatter? (prettier in deps, biome, .editorconfig, rustfmt.toml, black in pyproject)
- Type checking? (tsconfig.json, mypy.ini, pyrightconfig.json)

**Build:**
- How do you build? (check scripts in package.json, Makefile, Dockerfile, docker-compose.yml)
- Does the build produce artifacts?

**VCS & Reviews:**
- Default branch name?
- CODEOWNERS file?
- PR template?
- Issue templates?
- Review bots? Check for: .coderabbit.yaml, .sourcery.yaml, .greptile/, dependabot.yml, renovate.json
- Also check recent PR comments/reviews for bot usernames (coderabbitai[bot], sourcery-ai[bot], etc.)

**Documentation:**
- docs/ directory?
- README.md — how detailed is it?
- CHANGELOG.md?
- API docs (generated or manual)?

**Security:**
- .env.example present?
- SECURITY.md?
- Secret scanning or CodeQL configured?
- Dependency update bot (dependabot.yml, renovate.json)?

**Project Intelligence:**
- CLAUDE.md present? Read it carefully — it contains the repo's conventions, CI gate commands, and gotchas.
- AGENTS.md? .cursorrules? .github/copilot-instructions.md?
- Conventional commits? (check recent commit messages for patterns like feat:, fix:, chore:)

**Spec Management:**
- Where do specs/issues live? (GitHub Issues, docs/specs/, docs/adr/, docs/rfc/)
- Issue templates present?
- How are PRs linked to issues? (branch naming conventions, "Closes #X" in commits)

## Phase 2: Judgment Calls

Based on what you found, answer:
1. What does this repo actually do? (one paragraph)
2. What's the full CI gate command? (the exact sequence to run before committing)
3. What are the repo's conventions that an engineer must follow?
4. What's fragile or unusual? (scan for TODO, FIXME, HACK comments; check CLAUDE.md gotchas)
5. If monorepo: do capabilities differ per package?

## Output

You MUST output a JSON block with the following schema. Output it on a line starting with \`REPO_CONFIG:\` followed by the JSON. Do not wrap in markdown code fences.

REPO_CONFIG:{"repo":"org/name","defaultBranch":"main","description":"...","languages":["typescript"],"monorepo":false,"packages":[],"ci":{"supported":true,"provider":"github-actions","gateCommand":"pnpm lint && pnpm build && pnpm test","hasMergeQueue":false,"requiredChecks":["build","test"]},"testing":{"supported":true,"framework":"vitest","runCommand":"pnpm test","hasCoverage":true,"coverageThreshold":98},"linting":{"supported":true,"tool":"biome","runCommand":"pnpm lint"},"formatting":{"supported":true,"tool":"biome","runCommand":"pnpm format"},"typeChecking":{"supported":true,"tool":"tsc","runCommand":"pnpm check"},"build":{"supported":true,"runCommand":"pnpm build","producesArtifacts":true,"dockerfile":false},"reviewBots":{"supported":false,"bots":[]},"docs":{"supported":false,"location":null,"hasApiDocs":false},"specManagement":{"tracker":"github-issues","specLocation":"issue-comments","hasTemplates":false},"security":{"hasEnvExample":false,"hasSecurityPolicy":false,"hasSecretScanning":false,"hasDependencyUpdates":false},"intelligence":{"hasClaudeMd":false,"hasAgentsMd":false,"conventions":[],"ciGateCommand":null}}

After the REPO_CONFIG, output a gaps section. For each missing capability, output a line starting with \`GAP:\` followed by JSON:

GAP:{"capability":"ci","title":"Set up CI pipeline","priority":"high","description":"No CI configuration found. Add GitHub Actions workflows for lint, build, and test."}
GAP:{"capability":"testing","title":"Add test framework and initial tests","priority":"high","description":"No test files or test framework configuration found."}

Only output GAPs for capabilities where supported is false or important sub-capabilities are missing.

Finally, if no CLAUDE.md exists, output a \`CLAUDE_MD:\` line followed by the full contents of a bootstrapped CLAUDE.md for this repo, based on everything you learned. If one already exists, output \`CLAUDE_MD:EXISTS\`.

interrogation_complete`;

/**
 * Parse the interrogation output into structured data.
 */
export interface RepoConfig {
  repo: string;
  defaultBranch: string;
  description: string;
  languages: string[];
  monorepo: boolean;
  packages?: { name: string; path: string; description: string }[];
  ci: {
    supported: boolean;
    provider?: string;
    gateCommand?: string;
    hasMergeQueue?: boolean;
    requiredChecks?: string[];
  };
  testing: {
    supported: boolean;
    framework?: string;
    runCommand?: string;
    hasCoverage?: boolean;
    coverageThreshold?: number;
  };
  linting: {
    supported: boolean;
    tool?: string;
    runCommand?: string;
  };
  formatting: {
    supported: boolean;
    tool?: string;
    runCommand?: string;
  };
  typeChecking: {
    supported: boolean;
    tool?: string;
    runCommand?: string;
  };
  build: {
    supported: boolean;
    runCommand?: string;
    producesArtifacts?: boolean;
    dockerfile?: boolean;
  };
  reviewBots: {
    supported: boolean;
    bots?: string[];
  };
  docs: {
    supported: boolean;
    location?: string | null;
    hasApiDocs?: boolean;
  };
  specManagement: {
    tracker: string;
    specLocation?: string;
    hasTemplates?: boolean;
  };
  security: {
    hasEnvExample?: boolean;
    hasSecurityPolicy?: boolean;
    hasSecretScanning?: boolean;
    hasDependencyUpdates?: boolean;
  };
  intelligence: {
    hasClaudeMd: boolean;
    hasAgentsMd: boolean;
    conventions: string[];
    ciGateCommand?: string | null;
  };
}

export interface Gap {
  capability: string;
  title: string;
  priority: "high" | "medium" | "low";
  description: string;
}

export interface InterrogationResult {
  config: RepoConfig;
  gaps: Gap[];
  claudeMd: string | null; // null means CLAUDE.md already exists
}

/**
 * Parse raw AI output into structured InterrogationResult.
 * Scans lines for REPO_CONFIG:, GAP:, and CLAUDE_MD: prefixes.
 */
export function parseInterrogationOutput(output: string): InterrogationResult {
  const lines = output.split("\n");

  let config: RepoConfig | null = null;
  const gaps: Gap[] = [];
  let claudeMd: string | null = null;
  let inClaudeMd = false;
  const claudeMdLines: string[] = [];

  for (const line of lines) {
    if (inClaudeMd) {
      // Everything after CLAUDE_MD: until end is the CLAUDE.md content
      // (unless we hit interrogation_complete signal)
      if (line.trim() === "interrogation_complete") break;
      claudeMdLines.push(line);
      continue;
    }

    if (line.startsWith("REPO_CONFIG:")) {
      const json = line.slice("REPO_CONFIG:".length).trim();
      config = JSON.parse(json) as RepoConfig;
    } else if (line.startsWith("GAP:")) {
      const json = line.slice("GAP:".length).trim();
      gaps.push(JSON.parse(json) as Gap);
    } else if (line.startsWith("CLAUDE_MD:")) {
      const rest = line.slice("CLAUDE_MD:".length).trim();
      if (rest === "EXISTS") {
        claudeMd = null;
      } else {
        inClaudeMd = true;
        if (rest) claudeMdLines.push(rest);
      }
    }
  }

  if (inClaudeMd && claudeMdLines.length > 0) {
    claudeMd = claudeMdLines.join("\n").trim();
  }

  if (!config) {
    throw new Error("Interrogation output missing REPO_CONFIG line");
  }

  return { config, gaps, claudeMd };
}
