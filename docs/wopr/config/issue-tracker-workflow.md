# Issue Tracker Workflow — The WOPR Implementation

> Implements: [method/config/issue-tracker-workflow.md](../../method/config/issue-tracker-workflow.md)

---

## Linear as Issue Tracker

WOPR uses Linear (linear.app) for issue tracking.

### Team Configuration

- **Team**: WOPR
- **Team ID**: `dca92d56-659a-4ee9-a8d1-69d1f0de19e0`
- **Org**: wopr-network
- **Access**: Via MCP server (`mcp__linear-server__*` tools)

### States

| State | Type | Meaning |
|-------|------|---------|
| Triage | triage | Raw input, not yet validated |
| Todo | unstarted | Validated, prioritized, ready for work |
| In Progress | started | Agent is actively working |
| Done | completed | PR merged |
| Cancelled | canceled | Rejected or obsolete |

### State Transitions

| From | To | How |
|------|----|-----|
| — | Todo | `/wopr:groom` creates issues with `state: "Todo"` |
| Todo | In Progress | `/wopr:auto` picks up issue (manual update or GitHub integration) |
| In Progress | Done | GitHub↔Linear integration auto-moves when PR merges |
| Any | Cancelled | Human cancels in Linear UI |

**Critical**: Issues are ALWAYS created with `state: "Todo"`, never Triage. The grooming process validates before creation.

## Issue Description Contract

Every issue description starts with:
```
**Repo:** wopr-network/<repo-name>
```

This is how `/wopr:auto` determines which repo the issue belongs to.

Full description includes:
```markdown
**Repo:** wopr-network/wopr-plugin-discord

## Problem
<what's wrong or what's needed>

## Solution
<high-level approach>

## Acceptance Criteria
- [ ] <specific, testable criterion>
- [ ] <specific, testable criterion>
```

## Priority Levels

| Linear Priority | Value | Pipeline Behavior |
|----------------|-------|------------------|
| Urgent | 1 | Processed first |
| High | 2 | Processed after urgent |
| Normal | 3 | Standard queue position |
| Low | 4 | Processed when nothing higher |
| None | 0 | Sorted last |

Sorting: `Urgent (1) > High (2) > Medium (3) > Low (4) > None (0)`

## Labels

Existing labels in the WOPR team:

| Label | Use |
|-------|-----|
| `wopr-core` | Issues in the main wopr repo |
| `plugin-discord` | Issues in wopr-plugin-discord |
| `security` | Security-related work |
| `testing` | Test coverage and quality |
| `refactor` | Code improvement |
| `tech-debt` | Technical debt cleanup |
| `devops` | Infrastructure and operations |
| `Bug` | Bug fixes |
| `Feature` | New features |
| `Improvement` | Enhancements to existing features |

New labels created on demand for repos that don't have one:
```
mcp__linear-server__create_issue_label({
  name: "<repo-name>",
  color: "<hex>",
  teamId: "dca92d56-659a-4ee9-a8d1-69d1f0de19e0"
})
```

## Blocking Relationships

Wired via Linear's relation API:

```
mcp__linear-server__save_issue({
  ...,
  relations: [
    { type: "blocks", issueId: "<blocked-issue-id>" }
  ]
})
```

**Both directions must be wired.** The `wopr-create-stories` skill enforces this.

### Unblocking Check

An issue is unblocked when ALL blockers have a **merged PR** — not just a Done status:

```bash
# Check if blocker's PR is actually merged
gh pr list --repo wopr-network/<repo> --state merged --head <branch>
```

Linear status Done can be set manually. A merged PR is an objective fact.

## Projects and Milestones

- **Project**: looked up dynamically via `mcp__linear-server__list_projects()`
- **Milestones**: Test Coverage, Security & Error Handling, Code Quality, Feature Completion
- **Milestones checked via**: `mcp__linear-server__list_milestones()`

## The wopr-create-stories Skill

Before creating any Linear issues, invoke this skill. It enforces:

1. `state: "Todo"` on every issue
2. Pre-creation backlog search for related issues
3. `parentId` for epics (search for active epics first)
4. Blocking graph wired atomically (both sides)
5. Active project looked up via `list_projects` (never hardcoded)
6. Description starts with `**Repo:** wopr-network/<repo>`

## GitHub↔Linear Integration

Linear's GitHub integration automatically:
- Links PRs to issues when the PR references the issue key (e.g., "Closes WOP-81")
- Moves issues to In Progress when a branch is created
- Moves issues to Done when the linked PR merges

This is why the pipeline doesn't manually update Linear status — the integration handles it.
