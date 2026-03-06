# Stage 0: Groom

Adversarial backlog generation — how work enters the system.

---

## Purpose

The grooming phase generates the backlog that feeds the pipeline. It answers: "What should we work on next?" — not with opinions, but with evidence.

## The Adversarial Pattern

Grooming is adversarial by design. Multiple advocates argue FOR work from different angles. A skeptic challenges every proposal. Only what survives the challenge becomes an issue.

### Why Adversarial?

Without challenge, backlogs bloat. Every TODO comment becomes a story. Every "a competitor has this" becomes a feature request. Every "we should probably" becomes a priority. The skeptic prevents this by demanding evidence, questioning necessity, and rejecting vague proposals.

### The Roles

| Role | Argues For | Evidence Sources |
|------|-----------|-----------------|
| **Codebase Advocate** | Work the code itself is asking for | TODOs, lint warnings, type errors, test gaps, outdated deps, large files |
| **Ecosystem Advocate** | Work based on external signals | Competitor features, platform updates, community requests, API changes |
| **Security Advocate** | Work based on risk | Vulnerabilities, dependency CVEs, input validation gaps, credential exposure |
| **Skeptic** | Challenges every proposal | Is it real? Is it needed now? Is it scoped right? Is it a duplicate? |

### The Flow

```
Advocates scan (parallel)
  ↓
Each submits proposals with evidence
  ↓
All proposals forwarded to skeptic
  ↓
Skeptic renders verdict per proposal:
  APPROVE — well-scoped, well-evidenced, worth doing
  CHALLENGE — has issues, needs rescoping or reprioritizing
  REJECT — YAGNI, duplicate, too vague, not our problem
  ↓
Lead judges:
  Approved → create issue
  Challenged → apply skeptic's suggestion, then create
  Rejected → drop (unless advocate evidence is overwhelming)
```

## Proposal Quality

A good proposal has:

- **Evidence** — file:line reference, metric, CVE number, concrete quote. Not "we should probably."
- **Scope** — can an agent complete this in one PR? If not, break it down.
- **Specificity** — enough detail for someone with no context to implement it.
- **Priority justification** — why now, not later?

A bad proposal has:

- Vibes instead of evidence ("feels like we should")
- Org-wide scope ("improve error handling everywhere")
- No actionable next step ("research options for X")
- Feature creep disguised as necessity ("while we're at it, let's also...")

## Scanning Patterns

### Codebase Scan

For each repo in the project:

- **TODO/FIXME/HACK markers** — grep the source for work the developers flagged
- **Dependency freshness** — check for outdated packages
- **Large files** — files over a threshold line count are candidates for decomposition
- **Test coverage gaps** — source files without corresponding test files
- **Type/lint errors** — unresolved compiler or linter warnings
- **Plan files** — check for documented but unimplemented work

### Ecosystem Scan

- **Competitor/peer projects** — what features are they shipping?
- **Platform updates** — new APIs, deprecated features, breaking changes
- **Community signals** — open issues from users, feature requests, bug reports
- **Cross-repo consistency** — do similar components follow the same patterns?

### Security Scan

- **Command injection vectors** — exec/spawn with unsanitized input
- **Path traversal** — file operations with user-controlled paths
- **Input validation gaps** — external input used without validation
- **Hardcoded secrets** — credentials in source code
- **Dependency vulnerabilities** — known CVEs in the dependency tree
- **Eval/dynamic code** — eval(), new Function(), vm.run()

## Deduplication

Before creating any issue, check:

1. Does this issue already exist in the backlog?
2. Is another proposal from a different advocate covering the same ground?
3. Is this a sub-task of an existing issue that should be expanded?
4. Does the codebase already have this capability? (Check the repo inventory before proposing "add X support" — X might already exist.)

## Output

The grooming phase produces:

- Prioritized issues in the issue tracker, each with:
  - Clear title
  - Description starting with repo identification
  - Priority based on evidence, not gut feel
  - Labels for categorization
  - Blocking relationships wired (both directions)
- A summary report: how many proposed, how many survived, breakdown by advocate and category

## Trigger

The grooming phase triggers when:

- The backlog drops below a threshold of unstarted issues
- A scheduled interval elapses (weekly, bi-weekly)
- A human manually invokes it
- An audit produces findings that need to be filed as issues
