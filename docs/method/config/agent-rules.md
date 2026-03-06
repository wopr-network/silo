# Agent Rules and Configuration

How agents receive their operating instructions — layered, inherited, and scoped.

---

## The Problem

Agents need instructions. Without them, they make their own decisions — and those decisions are inconsistent, context-free, and often wrong.

But instructions can't be monolithic. A rule that applies to the entire organization ("use conventional commits") is different from a rule that applies to one repo ("never import from `../core`"), which is different from a rule that applies to one agent invocation ("work only in this worktree").

## Instruction Layers

Agent instructions are layered, with more specific layers overriding more general ones:

```
Layer 1: Organization rules
  ↓ inherited by
Layer 2: Project/repo rules
  ↓ inherited by
Layer 3: Agent role rules (definition file)
  ↓ inherited by
Layer 4: Assignment rules (per-invocation context)
```

### Layer 1: Organization Rules

Apply to ALL agents across ALL repos in the organization.

Examples:
- "Use conventional commit messages"
- "Never commit secrets"
- "All PRs require review before merge"
- "Use squash merge, not merge commits"

These are universal invariants. They rarely change.

### Layer 2: Project/Repo Rules

Apply to all agents working in a specific repo.

Examples:
- "This repo uses Biome for linting, not ESLint"
- "Never import directly from `src/core/internal`"
- "The test suite OOMs in worktrees — use `npx vitest run <file>`"
- "Container names use `wopr-` prefix"

These encode repo-specific conventions and gotchas. They evolve as the codebase evolves.

### Layer 3: Agent Role Rules

Apply to a specific agent role regardless of which repo it's working in.

Examples:
- "Architects are read-only — never create, edit, or write files"
- "Coders implement FROM the spec, not from the issue description"
- "Reviewers check CI before reviewing code"
- "Fixers rebase before touching anything"

These are the role's constraints. They're part of the [agent definition file](../pipeline/agents/agent-format.md).

### Layer 4: Assignment Rules

Apply to this specific invocation of this specific agent.

Examples:
- "Your worktree is at `/path/to/worktree`"
- "The issue is WOP-42"
- "The PR is #17 in repo org/repo"
- "Previous findings: missing null check in auth.ts:42"

These are the per-task context. They change with every spawned agent.

## The Inheritance Model

```
Organization rules
  ├── never commit secrets
  ├── conventional commits
  └── squash merge

  Project rules (repo A)
    ├── use Biome
    ├── no direct imports from core
    └── inherits: org rules

    Agent role: coder
      ├── implement from spec
      ├── TDD workflow
      └── inherits: project rules + org rules

      Assignment: WOP-42
        ├── worktree: /path/to/worktree
        ├── branch: feature/wop-42
        └── inherits: role + project + org rules
```

When rules conflict, the more specific layer wins:
- Org says "use ESLint" but project says "use Biome" → Biome wins
- Role says "run all tests" but assignment says "run only auth tests" → auth tests wins

## Rule File Placement

Rules should live where agents can find them:

| Layer | Where it lives | How agents access it |
|-------|---------------|---------------------|
| Organization | Org-wide config, shared repo | Read at session start |
| Project | Repo root (e.g., `CLAUDE.md`, `.cursorrules`) | Read when entering the repo |
| Role | Agent definition file | Loaded at spawn time |
| Assignment | Inline in the spawn prompt | Part of the agent's initial context |

### The Rule File Convention

Most agent platforms support a rule file at the repo root. This file is automatically loaded when an agent operates in that repo. It serves as Layer 2 (project rules).

The file should contain:
- Codebase-specific conventions (naming, patterns, imports)
- Known gotchas (things that break if you do them wrong)
- Build/test commands specific to this repo
- Hard constraints (boundaries, forbidden patterns)

## Rule Evolution

Rules evolve through the [feedback loop](../feedback/learning-loop.md):

```
1. First occurrence of an issue → caught in review, fixed manually
2. Second occurrence → added as a rule (agents read it before coding)
3. Third occurrence → promoted to a gate (automated check in CI)
```

Rules are the middle tier between "we haven't seen this before" and "we have an automated check." They catch issues that are known but not yet automated.

### Gotchas Section

The most valuable part of any rule file is the gotchas — non-obvious things that go wrong:

```
## Gotchas

- **fleet**: Container names use `wopr-` prefix; node agent uses `tenant_` prefix — never conflate them.
- **auth**: Session tokens expire after 24h. Tests that hardcode future dates will break.
- **tests**: `pnpm test` in worktrees OOMs. Use `npx vitest run <specific-file>`.
```

Gotchas are hard-won operational knowledge. They come from bugs that were fixed, incidents that were resolved, and hours of debugging that shouldn't be repeated.

## Anti-Patterns

- **No rules** — agents operate on defaults and make inconsistent decisions.
- **Rules in the wrong layer** — org-level rules in a specific repo file, or repo-specific rules in the org config. Keep rules at the right scope.
- **Stale rules** — rules that reference patterns or tools that no longer exist. Review rules when the codebase changes significantly.
- **Contradictory rules** — "always use interface" in one file and "always use type" in another. The inheritance model resolves conflicts, but contradictions should be cleaned up.
- **Rules without rationale** — "never use X" without explaining why. When agents (or future humans) don't understand the rationale, they're more likely to violate the rule.
- **Too many rules** — a 1000-line rule file is a codebase in itself. Keep rules focused and concise. If a rule can be a gate (automated check), promote it to a gate and remove it from the rule file.
