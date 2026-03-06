# Stage 0: Groom — The WOPR Implementation

> Implements: [method/pipeline/stages/00-groom.md](../../../method/pipeline/stages/00-groom.md)

---

## Invocation

```
/wopr:groom
/wopr:groom security is the priority right now
/wopr:groom I want the Discord plugin refactored
```

The skill is defined in the Claude Code user settings as a skill block.

## WOPR's Adversarial Grooming

### The Team

WOPR creates a Claude Code team (`wopr-groom`) with 4 agents + lead:

| Agent | Name | Model | Role |
|-------|------|-------|------|
| Codebase Advocate | `codebase-advocate` | sonnet | Scans all local repos for TODOs, lint errors, test gaps, stale deps |
| Ecosystem Advocate | `ecosystem-advocate` | sonnet | Researches competitors, platform updates, community signals |
| Security Advocate | `security-advocate` | sonnet | Audits repos for injection vectors, secret exposure, CVEs |
| Skeptic | `skeptic` | sonnet | Challenges every proposal with evidence demands |
| Team Lead | main session | opus | Judges verdicts, creates Linear issues |

All 4 agents are spawned in parallel with `run_in_background: true` in a single message.

### The Scanning Process

**Phase 1: Discover the Org**

```bash
# Enumerate all repos
gh repo list wopr-network --json name,description,isArchived,primaryLanguage --limit 100

# Find local clones
ls -d /home/tsavo/wopr /home/tsavo/wopr-plugin-* /home/tsavo/wopr-claude-* /home/tsavo/wopr-skills 2>/dev/null

# Fetch existing Linear issues (deduplication)
mcp__linear-server__list_issues({ team: "WOPR", limit: 250, includeArchived: false })

# Check plan files
Glob({ pattern: "**/.claude/plans/*.md", path: "/home/tsavo" })

# Check milestones
mcp__linear-server__list_milestones({ project: "WOPR v1.0" })
```

A context brief is compiled and sent to ALL agents to prevent proposing features that already exist.

**Phase 2: Advocate Scanning**

Codebase advocate runs per local repo:
```bash
# TODOs
grep -rn "TODO\|FIXME\|HACK\|XXX" <repo>/src --include="*.ts"

# Dependency freshness
cd <repo> && npm outdated

# Large files
find src -name "*.ts" -exec wc -l {} + | sort -rn | head -10

# TypeScript errors
npx tsc --noEmit 2>&1 | tail -20
```

Security advocate runs per repo:
```bash
# Command injection
grep -rn "exec(\|execSync(\|spawn(" <repo>/src --include="*.ts"

# Dependency vulnerabilities
cd <repo> && npm audit 2>/dev/null | tail -20

# Secrets
grep -rn "password\|secret\|token\|apikey" <repo>/src --include="*.ts"
```

Ecosystem advocate runs web searches:
```
WebSearch({ query: "AI agent framework features 2026" })
WebSearch({ query: "discord.js v15 changelog new features" })
```

**Phase 3: Skeptic Challenge**

All proposals forwarded to skeptic. Skeptic renders:
- **APPROVE** — well-scoped, well-evidenced
- **CHALLENGE** — needs rescoping or reprioritizing
- **REJECT** — YAGNI, duplicate, too vague

**Phase 4: Create Issues**

For approved/challenged proposals, create Linear issues via:
```
mcp__linear-server__save_issue({
  title: "<title>",
  description: "**Repo:** wopr-network/<repo>\n\n<description>",
  teamId: "dca92d56-659a-4ee9-a8d1-69d1f0de19e0",
  state: "Todo",
  priority: <1-4>,
  labelIds: ["<label-id>"],
  projectId: "<active-project-id>"
})
```

Every issue description starts with `**Repo:** wopr-network/<repo-name>`.

## Linear Configuration

- **Team**: WOPR (ID: `dca92d56-659a-4ee9-a8d1-69d1f0de19e0`)
- **Project**: looked up dynamically via `mcp__linear-server__list_projects()`
- **Labels**: wopr-core, plugin-discord, security, testing, refactor, tech-debt, devops, Bug, Feature, Improvement
- **Milestones**: Test Coverage, Security & Error Handling, Code Quality, Feature Completion
- **States**: Triage → Todo → In Progress → Done
