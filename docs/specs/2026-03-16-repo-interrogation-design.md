# Repo Interrogation Design

**Date:** 2026-03-16
**Status:** Draft

## Overview

<<<<<<< HEAD
When a repo is onboarded to Holy Ship, it goes through a five-step sequence:

1. **Interrogate** — AI discovers what the repo has (capabilities, conventions, gaps)
2. **Checklist** — present gaps as an actionable checklist with "Create Issue" buttons
3. **Fix or skip** — Holy Ship fixes the gaps (through the engineering flow), or the customer accepts them
4. **Design flow** — AI takes the final repo config + engineering flow template → produces a custom flow tailored to this repo
5. **Holy Ship** — repo is onboarded, custom flow is live, work begins

The interrogation produces:

1. **A capabilities config** stored in Holy Ship's DB — used to design the flow and engineer prompts
2. **A bootstrapped CLAUDE.md** — the repo's public intelligence file (customer-controlled)
3. **Internal knowledge** — Holy Ship's private learning DB, updated continuously by the flow's learning step
4. **An actionable checklist** — each gap is a potential issue that Holy Ship can create and then actualize through the engineering flow
5. **A custom flow definition** — generated after gaps are resolved, tailored to what the repo actually supports
=======
When a repo is onboarded to Holy Ship, an AI interrogates it to discover its capabilities, conventions, and gaps. The result is:

1. **A capabilities config** stored in Holy Ship's DB — drives which flow gates/states apply at runtime
2. **A bootstrapped CLAUDE.md** — the repo's public intelligence file (customer-controlled)
3. **Internal knowledge** — Holy Ship's private learning DB, updated continuously by the flow's learning step
4. **An actionable checklist** — each gap is a potential issue that Holy Ship can create and then actualize through the engineering flow
>>>>>>> f6adf9d (docs: repo interrogation design spec)

## Architecture

### Two-phase interrogation (Approach C)

**Phase 1: File-pattern heuristics (no AI)**

Fast, deterministic checks that scan for the presence/absence of known files and patterns. Produces a partial capabilities config with high confidence.

Signals to check:

| Category | Signal Files / Patterns |
|----------|------------------------|
| **Package manager** | `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `Cargo.lock`, `go.sum`, `requirements.txt`, `poetry.lock` |
| **Monorepo** | `pnpm-workspace.yaml`, `lerna.json`, `nx.json`, `turbo.json`, `workspaces` in `package.json` |
| **Language** | File extensions (`.ts`, `.py`, `.go`, `.rs`), config files (`tsconfig.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`) |
| **Testing** | `vitest.config.*`, `jest.config.*`, `pytest.ini`, `**/test/**`, `**/tests/**`, `**/*.test.*`, `**/*.spec.*` |
| **CI** | `.github/workflows/*.yml`, `.circleci/config.yml`, `Jenkinsfile`, `.gitlab-ci.yml`, `bitbucket-pipelines.yml` |
| **Linter** | `biome.json`, `.eslintrc*`, `ruff.toml`, `.golangci.yml`, `.rubocop.yml` |
| **Formatter** | `prettier` in deps, `biome.json`, `.editorconfig`, `rustfmt.toml` |
| **Type checking** | `tsconfig.json`, `mypy.ini`, `pyrightconfig.json` |
| **Build** | `build` script in `package.json`, `Makefile`, `Dockerfile`, `docker-compose.yml` |
| **Docs** | `docs/`, `README.md` (length/quality heuristic), `CHANGELOG.md` |
| **VCS** | `.github/CODEOWNERS`, `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/` |
| **Dependencies** | Lockfile present, `dependabot.yml`, `renovate.json` |
| **Security** | `.env.example`, `SECURITY.md`, `.github/workflows/*codeql*`, `.github/workflows/*security*` |
| **Merge queue** | `merge_queue` in branch rulesets (GitHub API check) |
| **Review bots** | `dependabot.yml`, `.greptile/`, `.sourcery.yaml`, `.coderabbit.yaml` — also check recent PR comments for bot usernames |
| **Project intelligence** | `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.github/copilot-instructions.md` |
| **Spec management** | Issue templates, PR templates, `docs/specs/`, `docs/adr/`, `docs/rfc/` |

**Phase 2: AI interpretation (judgment calls)**

The AI receives the Phase 1 output plus access to read key files, and answers the questions that require understanding:

- What does this repo actually do? (read README, package.json description)
- How are specs managed? (issues, markdown files, external tracker)
- What are the conventions? (commit style, branch naming, PR workflow)
- What's the CI gate command? (parse workflow files to find the build/test/lint sequence)
- What's fragile or unusual? (read CLAUDE.md if it exists, scan for TODO/FIXME/HACK comments)
- If monorepo: what does each package do, and do capabilities differ per package?

### Output Schema

```typescript
interface RepoConfig {
  /** Repo identity */
  repo: string;                    // "org/repo"
  defaultBranch: string;           // "main"
  description: string;             // AI-generated summary
  languages: string[];             // ["typescript", "python"]

  /** Structure */
  monorepo: boolean;
  packages?: PackageConfig[];      // per-package overrides if monorepo

  /** Capabilities — each is { supported: boolean, details: {...} } */
  ci: {
    supported: boolean;
    provider?: string;             // "github-actions", "circleci", etc.
    gateCommand?: string;          // "pnpm lint && pnpm build && pnpm test"
    hasMergeQueue?: boolean;
    requiredChecks?: string[];
  };
  testing: {
    supported: boolean;
    framework?: string;            // "vitest", "jest", "pytest", etc.
    runCommand?: string;           // "pnpm test"
    hasCoverage?: boolean;
    coverageThreshold?: number;
  };
  linting: {
    supported: boolean;
    tool?: string;                 // "biome", "eslint", "ruff"
    runCommand?: string;
  };
  formatting: {
    supported: boolean;
    tool?: string;
    runCommand?: string;
  };
  typeChecking: {
    supported: boolean;
    tool?: string;                 // "tsc", "mypy", "pyright"
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
    bots?: string[];               // ["coderabbitai", "sourcery-ai", "greptile"]
  };
  docs: {
    supported: boolean;
    location?: string;             // "docs/", "README.md only"
    hasApiDocs?: boolean;
  };
  specManagement: {
    tracker: string;               // "github-issues", "linear", "jira", "markdown"
    specLocation?: string;         // "issue-comments", "docs/specs/", etc.
    hasTemplates?: boolean;
  };
  security: {
    hasEnvExample?: boolean;
    hasSecurityPolicy?: boolean;
    hasSecretScanning?: boolean;
    hasDependencyUpdates?: boolean;
  };

  /** Project intelligence */
  intelligence: {
    hasClaudeMd: boolean;
    hasAgentsMd: boolean;
    conventions: string[];         // ["conventional-commits", "squash-merge", etc.]
    ciGateCommand?: string;        // the full gate command from CLAUDE.md
  };
}
```

### Gap Detection & Issue Generation

Each capability maps to a gap assessment:

| Capability | Gap Condition | Issue Title | Priority |
|-----------|--------------|-------------|----------|
| CI | `ci.supported === false` | "Set up CI pipeline" | high |
| Tests | `testing.supported === false` | "Add test framework and initial tests" | high |
| Linter | `linting.supported === false` | "Configure linter" | medium |
| Formatter | `formatting.supported === false` | "Configure code formatter" | medium |
| Type checking | `typeChecking.supported === false` | "Add type checking" | medium |
| Coverage | `testing.hasCoverage === false` | "Configure test coverage thresholds" | low |
| CLAUDE.md | `intelligence.hasClaudeMd === false` | "Bootstrap CLAUDE.md with repo conventions" | high |
| Merge queue | `ci.hasMergeQueue === false` | "Enable merge queue for main branch" | low |
| PR template | no PR template detected | "Add pull request template" | low |
| Dependency updates | `security.hasDependencyUpdates === false` | "Configure Dependabot/Renovate" | medium |
| Security policy | `security.hasSecurityPolicy === false` | "Add SECURITY.md" | low |
| Docs | `docs.supported === false` | "Set up documentation" | low |

### Checklist UI

The onboarding experience presents the interrogation result as a checklist:

```
✅ TypeScript (detected)
✅ pnpm (lockfile found)
✅ CI — GitHub Actions (6 workflows)
✅ Tests — vitest (coverage at 98%)
✅ Linter — biome
❌ No CLAUDE.md                    [Create Issue]
❌ No merge queue                  [Create Issue]
❌ No PR template                  [Create Issue]
⚠️  No coverage on packages/utils  [Create Issue]
```

Each "Create Issue" button creates an issue in the repo's configured issue tracker. That issue enters the engineering flow. Holy Ship fixes the gap.

### Knowledge Persistence

**Customer-visible:** CLAUDE.md in the repo. Bootstrapped by interrogation, optionally updated by the learning step. Customer controls whether updates are allowed.

**Holy Ship internal:** Repo config + learned knowledge in our DB. Always updated by the learning step regardless of customer CLAUDE.md preferences. Used by the cloud's prompt engineering to build smarter prompts over time.

The internal knowledge accumulates:
- Gate failure patterns ("CI takes 8min on this repo, don't time out at 5")
- Review bot behavior ("Qodo posts late, don't wait for it")
- Merge quirks ("merge queue gets stuck, dequeue/re-enqueue fixes it")
- Code patterns ("auth module is fragile, always run auth tests explicitly")

### Prompt Engineering — The Central Purpose

The repo knowledge is the primary input to every prompt the cloud constructs. This is not a side effect — it's the reason the interrogation exists.

Every state in the engineering flow has a prompt template. Those templates are generic ("write the implementation," "review the PR"). What makes them effective is the repo context injected at render time:

- **Conventions:** "This repo uses biome, not eslint. Run `pnpm check` before committing. Imports must be sorted: external → parent → sibling."
- **CI gate:** "Before pushing, run: `pnpm lint && pnpm format && pnpm build && pnpm test`. All four must pass."
- **Fragile areas:** "The auth module breaks when you touch session middleware. Always run `npx vitest run tests/auth/` explicitly."
- **Review patterns:** "Qodo posts late — don't wait for it. CodeRabbit and Sourcery are the required reviewers."
- **Merge quirks:** "This repo uses a merge queue. Use `gh pr merge --auto`. If DIRTY after another PR merges, dequeue and re-enqueue."

The interrogation bootstraps this context. The learning step enriches it after every flow run. The cloud's prompt quality improves with every entity that passes through the system — not because the templates change, but because the repo knowledge deepens.

**The prompt engineering loop:**

```
interrogation → initial repo knowledge
                        ↓
        cloud builds prompts with repo context
                        ↓
                runner executes work
                        ↓
        learning step captures what happened
                        ↓
        repo knowledge updated in DB
                        ↓
        next prompt is smarter ←────────┘
```

This is what separates Holy Ship from "run an AI on a repo." The system learns each repo's personality and engineers prompts accordingly. A repo that's been through 100 flows gets dramatically better prompts than one on its first run.

### Flow Adaptation

The `RepoConfig` also drives structural flow behavior:

- **Gate selection:** If `ci.supported === false`, skip `ci-green` gate. If `reviewBots.supported === false`, skip review bot wait.
- **State skipping:** If `docs.supported === false`, skip the `docs` state entirely.
- **Model selection:** Complex repos with strict conventions might warrant `opus` for spec, `sonnet` for code.
- **Timeout tuning:** If we know CI takes 8 minutes on this repo, set the gate timeout to 10, not the default 2.

### Runner Execution

The interrogation runs on the runner (Phase 1 heuristics + Phase 2 AI) because:
- The runner has the code checked out
- The runner has the GitHub token for API calls
- The cloud stays blind to the actual repo content
- The runner sends back the structured `RepoConfig` — not the code itself

The cloud stores the config and uses it for prompt engineering and flow orchestration. The blind boundary holds — the cloud never sees source code, but it knows everything about how the repo works.
<<<<<<< HEAD

### Flow Design — The Final Step

After the interrogation checklist is resolved (gaps fixed or accepted), the AI designs a custom flow for the repo. The baked-in engineering flow is a **template**, not a prescription.

**Input:**
- The finalized `RepoConfig` (post-fix)
- The engineering flow template (spec → code → review → fix → docs → learning → merge → done)

**Process:**

The AI examines what the repo actually supports and adapts the template:

| Repo Reality | Flow Adaptation |
|---|---|
| No tests, no CI | Remove `ci-green` gate. Code state prompt says "commit directly, no CI to validate against." |
| Has CI but no review bots | Keep `ci-green` gate, remove review bot wait from review state. Review prompt focuses on self-review. |
| Monorepo with 5 packages | Add per-package parallelism. Gates evaluate per-package (some may have tests, others may not). |
| Python ML repo | Replace TypeScript-oriented prompts. Add notebook-aware code state. Docs state generates docstrings, not markdown. |
| Strict enterprise repo | Full pipeline. Add approval gates. Longer timeouts. Require spec sign-off before coding. |
| Single-file script repo | Minimal flow: code → commit → done. No spec, no review, no docs. |

**Output:**

A complete flow definition — states, transitions, gates, prompts, agent roles, timeouts — stored in the DB and used by the flow engine. This is the same `CreateFlowInput` + `CreateStateInput` + `CreateGateInput` + `CreateTransitionInput` shape that the baked-in engineering flow uses.

The customer sees their custom flow in the dashboard. They can tweak it — toggle states on/off, adjust timeouts, modify prompts. But they start from an intelligent default that matches their repo, not a generic template.

**Evolution:**

As the repo changes — adds CI, adds tests, adopts a linter — the interrogation can re-run and the AI can propose flow updates. "Your repo now has CI. Want to add a CI gate to your flow?" This is a one-click upgrade, not a manual reconfiguration.

The flow grows with the repo. The template is just how it starts.
=======
>>>>>>> f6adf9d (docs: repo interrogation design spec)
