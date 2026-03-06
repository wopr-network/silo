# Agent Role Specifications

The canonical roles in an agentic engineering pipeline and what each one does.

---

## The Role Taxonomy

Every agent in the pipeline fits one of these roles. Roles can be combined in simple systems or split further in complex ones, but these are the primitives.

### Build Phase Roles

| Role | Input | Output | Model Tier | Lifecycle |
|------|-------|--------|------------|-----------|
| **Groomer** | Codebase + ecosystem signals | Prioritized issues in the tracker | Reasoning | Ephemeral per grooming session |
| **Architect** | Issue description + codebase | Implementation spec on the issue | Reasoning | Ephemeral per issue |
| **Coder** | Architect's spec | PR on a feature branch | Execution | Ephemeral per issue |
| **Reviewer** | PR diff + bot comments | CLEAN or ISSUES verdict | Execution | Ephemeral per review |
| **Fixer** | Review findings | Pushed fixes to PR branch | Execution | Ephemeral per fix cycle |

### Operational Roles

| Role | Input | Output | Model Tier | Lifecycle |
|------|-------|--------|------------|-----------|
| **Deployer** | Merge event or manual trigger | Running production artifact | Execution | Ephemeral per deploy |
| **Verifier** | Deploy event | Health/smoke test results | Execution | Ephemeral per verification |
| **Watcher** | PR in merge queue | Merge/block status report | Monitoring | Ephemeral per PR |

### Quality Roles

| Role | Input | Output | Model Tier | Lifecycle |
|------|-------|--------|------------|-----------|
| **Auditor** | Codebase | Findings report | Reasoning | Ephemeral per audit |
| **QA Lead** | Deploy event + test results | Go/no-go decision | Execution | Ephemeral per deploy |

### Coordination Roles

| Role | Input | Output | Model Tier | Lifecycle |
|------|-------|--------|------------|-----------|
| **Pipeline Lead** | Backlog + agent messages | Agent spawn/shutdown decisions | Reasoning | Long-lived per session |
| **Team Lead** | Agent reports | Triaged findings | Execution | Long-lived per session |

---

## Role Details

### Groomer (Multiple Sub-Roles)

The grooming phase uses multiple adversarial agents:

**Advocates** argue FOR work from different angles:
- **Codebase advocate** — scans source code for TODOs, test gaps, lint errors, outdated dependencies
- **Ecosystem advocate** — scans external signals: competitor features, platform updates, community requests
- **Security advocate** — scans for vulnerabilities: injection vectors, path traversal, secret exposure, CVEs

**Skeptic** challenges every proposal:
- Demands evidence
- Questions necessity and timing
- Rejects duplicates and vague proposals
- Ensures scope is achievable in one PR

**Team Lead** judges the debate:
- Approves well-evidenced proposals
- Applies skeptic suggestions to challenged proposals
- Drops rejected proposals (unless evidence is overwhelming)
- Creates issues in the tracker

### Architect

**Read-only.** The architect reads the codebase and the issue, then posts a detailed implementation spec. It never writes code.

The spec contains:
- Files to create or modify (exact paths)
- Function signatures (names, parameters, return types)
- Data structures (schemas, types, interfaces)
- Implementation steps (ordered, specific, actionable)
- Test plan (what to test, what to assert)
- Edge cases and gotchas

For UI work, a **design architect** produces a companion spec covering aesthetics, typography, color palette, animations, and responsive strategy.

### Coder

Implements FROM the architect's spec. The coder reads the spec, follows TDD (write failing test → implement → verify), creates a PR, and shuts down.

The coder does not:
- Redesign the solution
- Run the full test suite (only targeted tests)
- Refactor surrounding code
- Add features not in the spec

### Reviewer

Reads the PR diff and ALL review bot comments (three feeds: inline, formal reviews, top-level), then renders a verdict:

- **CLEAN** — no blocking issues found
- **ISSUES** — list of findings with file:line, description, and source

The reviewer checks CI first. If CI is failing, it reports ISSUES immediately without reviewing code.

### Fixer

Reads review findings and pushes targeted fixes. Works from the existing PR branch. Rebases before fixing. Addresses each finding individually. Does not refactor or add features.

### Watcher

A lightweight agent that polls until a PR resolves in the merge queue. Reports:
- "Merged" — PR successfully merged
- "Blocked" — CI failed in the queue
- "Closed" — PR was closed without merging

### Pipeline Lead

The orchestrator. Manages the pipeline state, spawns agents, reacts to messages, fills slots, and handles backpressure. This is typically the main session (the human's conversation), not a spawned agent.

## Model Tier Routing

Agents are routed to different model tiers based on the reasoning depth required:

| Tier | Reasoning Depth | Roles | Why |
|------|----------------|-------|-----|
| **Reasoning** | Deep analysis, design decisions, architectural judgment | Architect, Design Architect, Auditor, Pipeline Lead | These roles make decisions that compound. A bad spec wastes all downstream work. |
| **Execution** | Follow clear instructions, apply patterns | Coder, Reviewer, Fixer, QA Lead, Deployer | These roles execute against specs. The thinking is done; they follow. |
| **Monitoring** | Simple conditional logic, polling | Watcher, Updater | These roles check status and report. Minimal reasoning required. |

Using a reasoning-tier model for a watcher wastes resources. Using an execution-tier model for an architect produces shallow specs that cause downstream failures. Match the model to the role.

## Anti-Patterns

- **Monolith agent** — one agent that specs, codes, reviews, and fixes. No separation of concerns, no gate between stages.
- **Permanent agents** — agents that live between assignments. They accumulate state, drift from their role, and become unpredictable.
- **Over-specialized roles** — an agent for every file type. Keep roles at the task level (spec, code, review), not the file level.
- **Under-specified roles** — "just figure it out" is not a role. Every role has a defined input, output, and constraint set.
