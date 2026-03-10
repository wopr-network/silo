# Multi-Repo Entity Support

> Design spec for supporting issues that span multiple repositories.

## Problem

A single Linear issue (e.g., WOP-2104) can require work across multiple repos (e.g., `wopr-platform` + `platform-core`). Silo currently assumes one entity = one repo = one worktree = one PR. Multi-repo issues cannot be processed.

## Design Principle

Every entity carries an **array** of repos. There is no single-repo concept. Single-repo issues are arrays of length 1. No special casing anywhere in the pipeline.

## Data Flow

### 1. Ingestion — Repo Parsing

The ingestion layer parses the `**Repo:**` line from the issue description.

```
**Repo:** wopr-network/wopr-platform + wopr-network/platform-core
```

Parsed into:

```json
{ "repos": ["wopr-network/wopr-platform", "wopr-network/platform-core"] }
```

Stored in `entity.payload.repos` at entity creation time. If no `**Repo:**` line is found, fall back to the flow-level default repo (as an array of one).

### 2. onEnter — Multi-Worktree Provisioning (nuke)

The `onEnter` hook (executed by nuke) receives the repos array from `entity.payload.repos`.

For each repo in the array:
1. Clone or create a git worktree under `/worktrees/{entity-id}/{repo-name}/`

Returns JSON:

```json
{
  "worktrees": {
    "wopr-platform": "/worktrees/abc123/wopr-platform",
    "platform-core": "/worktrees/abc123/platform-core"
  }
}
```

Stored in `entity.artifacts.worktrees`.

Directory layout is flat siblings — no hierarchy implied:

```
/worktrees/{entity-id}/
├── wopr-platform/
└── platform-core/
```

### 3. Agent Execution

The agent is spawned with all worktree paths in its prompt. It works across all repos, creates a PR in each, and stores PR URLs in artifacts.

No changes to agent invocation — still one claude process per entity. The prompt template references `{{entity.artifacts.worktrees}}` to list available repos and paths.

### 4. Artifact Schema

```json
{
  "repos": ["wopr-network/wopr-platform", "wopr-network/platform-core"],
  "worktrees": {
    "wopr-platform": "/worktrees/abc123/wopr-platform",
    "platform-core": "/worktrees/abc123/platform-core"
  },
  "prs": {
    "wopr-platform": "https://github.com/wopr-network/wopr-platform/pull/123",
    "platform-core": "https://github.com/wopr-network/platform-core/pull/45"
  }
}
```

Keys in `worktrees` and `prs` are the repo name (not full `owner/name`). The full repo identifier is in the `repos` array.

### 5. Gate Evaluation

Gate scripts are **unchanged**. They still accept `(PR_NUMBER, REPO)` and return 0/1.

The change is in **silo's gate evaluator**. For any gate that operates on PRs:

1. Read `entity.artifacts.prs` (a map of repo → PR URL)
2. For each entry, extract PR number and repo
3. Call the gate script once per repo/PR pair
4. AND all results — pass only when every invocation returns 0

Gates that operate on the issue itself (e.g., `spec-posted.sh` which checks a Linear issue for a spec comment) are called once, as today.

#### Gate classification

| Gate | Operates on | Invocation |
|------|-------------|------------|
| `spec-posted.sh` | Linear issue | Once per entity |
| `review-bots-ready.sh` | PR | Once per repo, AND results |
| `merge-queue.sh` | PR | Once per repo, AND results |

### 6. Backwards Compatibility

Existing single-repo issues get `repos: ["wopr-network/whatever"]`. The loop runs once. No behavioral change.

Existing gate scripts take the same arguments. No changes needed in cheyenne-mountain.

## Changes by Repo

### silo
- **Ingestion**: Parse `**Repo:**` line into repos array
- **Entity creation**: Store repos in `entity.payload.repos`
- **Gate evaluator**: Loop over `artifacts.prs`, call gate per repo/PR, AND results
- **Prompt templates**: Expose `artifacts.worktrees` map to agent

### nuke
- **provision-worktree**: Accept repos array, provision one worktree per repo, return worktrees map

### cheyenne-mountain
- **No changes** — gate scripts already accept `(PR_NUMBER, REPO)` and work on a single PR
