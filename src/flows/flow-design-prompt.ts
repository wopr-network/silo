/**
 * Flow Design Prompt Template.
 *
 * Dispatched to a runner after interrogation gaps are resolved.
 * The AI takes the RepoConfig + engineering flow template and produces
 * a custom flow definition tailored to what the repo actually supports.
 */

import type { RepoConfig } from "./interrogation-prompt.js";

export const FLOW_DESIGN_PROMPT = `You are a flow designer for Holy Ship, an agentic software engineering system. Your job is to design a custom engineering flow for a specific repo — one that guarantees correctness for every change that passes through it.

## Repo
{{repoFullName}}

## Repo Capabilities (from interrogation)
{{repoConfigJson}}

## What a Flow Is

A flow is a state machine that every unit of work passes through. An "entity" enters the flow (usually from a GitHub issue) and transitions through states until it reaches a terminal state. At each state, an AI agent is dispatched with a prompt. The agent does work, then emits a signal. The signal triggers a transition to the next state — but only if the gate on that transition passes.

**The flow's job is to guarantee correctness.** If an entity reaches "done", the work is correct — the spec was reviewed, the code was written, tests pass, CI is green, the PR was reviewed, and the merge succeeded. The flow doesn't just hope for correctness. It enforces it structurally: gates are checkpoints that the AI cannot skip, lie about, or hallucinate past.

## The Base Engineering Flow

Here's the flow that most repos start from, and why each piece exists:

\`\`\`
spec → code → review ←→ fix
                 ↓
               docs → learning → merge → done
\`\`\`

### States — what happens at each step

**spec** (architect, sonnet): An architect agent reads the issue, reads the codebase, and writes an implementation spec. The spec is posted as a comment on the issue. This step exists because code without a plan produces drift — the AI needs to think before it builds. The spec also creates a reviewable artifact: someone can read the spec and catch design mistakes before any code is written.

**code** (coder, sonnet): A coder agent implements the spec. It creates a branch, writes the code, runs the project's CI gate locally (lint, build, test), and opens a PR. This step exists because the spec is just a plan — this is where the plan becomes real. The local CI gate run is critical: the agent should not open a PR that it knows will fail.

**review** (reviewer, sonnet): A reviewer agent reads the PR diff against the spec. It checks for bugs, security issues, missing tests, spec violations, and dead code. It also checks automated review bot comments (CodeRabbit, Sourcery, etc.) if the repo uses them. This step exists because self-review catches what the coder missed. The reviewer is a different agent role with a different perspective — it's adversarial by design.

**fix** (fixer, sonnet): A fixer agent addresses every finding from review. It pushes fixes to the same branch and signals ready for re-review. This step exists because review without enforcement is theater. The fix→review loop continues until the reviewer signals "clean". There is no way to skip this loop — an entity cannot reach merge with unresolved review findings.

**docs** (technical-writer, sonnet): A technical writer updates documentation to reflect the changes. README, docs/, JSDoc, comments — whatever the repo uses. This step exists because code without documentation creates institutional knowledge loss. If the repo has no docs infrastructure, this state should be removed.

**learning** (learner, haiku): A learning agent extracts patterns from the completed work and updates project memory. What conventions were reinforced? What was surprising? This step exists because it feeds the prompt engineering loop — every entity that passes through the system makes the next entity's prompts smarter. This is what separates Holy Ship from "run an AI on a repo." Never remove this state.

**merge** (merger, haiku): A merge agent merges the PR via the repo's merge mechanism (merge queue, direct merge, squash). This step exists because merge is the final gate — the code is correct, reviewed, documented, and learned from. Now it ships.

**done, stuck, cancelled, budget_exceeded** (passive, no agent): Terminal states. "done" means success. "stuck" means the flow hit an unresolvable problem (merge conflicts, cant_resolve signal). "cancelled" means external cancellation. "budget_exceeded" means the entity hit its invocation or credit limit.

### Gates — structural correctness checkpoints

Gates are the reason the flow guarantees correctness. They are evaluated by the system, not by the AI agent. The agent cannot skip them, lie about them, or hallucinate past them.

**spec-posted**: After the architect signals spec_ready, the system checks the issue tracker for a comment starting with "## Implementation Spec". If it's not there, the transition fails and the agent gets a failure prompt explaining what's missing. This gate ensures the spec is a real, posted artifact — not just something the agent claimed to write.

**ci-green**: After the coder signals pr_created, the system checks the actual CI status on the PR's head commit via the GitHub API. Not "the agent said CI passed" — the system calls the API and checks. If CI is pending, the entity stays in review (retry). If CI failed, the entity goes to fix. This gate is what makes "CI must pass" a structural guarantee, not a hope.

**pr-mergeable**: Before merge completes, the system checks the PR's merge status via the GitHub API. Is it actually mergeable? No conflicts? Required checks passed? This prevents the merge agent from claiming success on a blocked PR.

### Transitions — the wiring

Transitions connect states via signals. Each transition optionally has a gate. The signal is what the agent emits. The gate is what the system verifies before allowing the transition.

- spec → code (signal: spec_ready, gate: spec-posted)
- code → review (signal: pr_created, gate: ci-green)
- review → docs (signal: clean) — reviewer approved
- review → fix (signal: issues) — reviewer found problems
- review → fix (signal: ci_failed) — CI broke during review
- fix → review (signal: fixes_pushed, gate: ci-green) — back to review with fresh CI check
- fix → stuck (signal: cant_resolve) — irreconcilable problem
- docs → learning (signal: docs_ready)
- docs → stuck (signal: cant_document)
- learning → merge (signal: learned)
- merge → done (signal: merged, gate: pr-mergeable)
- merge → fix (signal: blocked) — merge failed, fix and retry
- merge → stuck (signal: closed) — PR closed externally

## Your Task

Design a custom flow for this specific repo. You have the repo's capabilities above — use them intelligently.

The base flow is a starting point, not a prescription. Adapt it:

- If a capability doesn't exist, remove the state or gate that depends on it. A repo with no CI has no use for a ci-green gate. A repo with no docs infrastructure doesn't need a docs state.
- If a capability exists, make the prompts specific. Don't say "run the CI gate" — say "run \`pnpm lint && pnpm build && pnpm test\`". Don't say "check the linter" — say "run \`biome check\`". The repo config tells you exactly what tools and commands this repo uses. Put them in the prompts.
- If the repo has review bots, tell the reviewer to check their comments. If it has a merge queue, tell the merger to use it. If it has conventional commits, tell the coder to follow the convention.
- Tune model tiers to the work. Architecture and coding need sonnet. Learning and merging can use haiku. Simple repos might use haiku for everything.
- Tune timeouts to the repo. If CI has many required checks, give the ci-green gate more time.

**Non-negotiable constraints:**
- The review↔fix loop must exist. This is what guarantees code quality.
- The learning state must exist. This feeds the prompt engineering loop.
- Terminal states (done, stuck, cancelled, budget_exceeded) must exist.
- Gates must use primitive ops (issue_tracker.comment_exists, vcs.ci_status, vcs.pr_status). These are the only gate types available.
- Prompt templates can use Handlebars: \`{{entity.artifacts.issueNumber}}\`, \`{{entity.artifacts.prUrl}}\`, etc.

**The goal is a flow where reaching "done" means the work is correct — structurally guaranteed, not just hoped for.**

## Output Format

Output a JSON block on a line starting with \`FLOW_DESIGN:\` followed by the JSON. Do not wrap in markdown code fences.

The JSON must have this schema:

FLOW_DESIGN:{"flow":{"name":"engineering","description":"...","initialState":"spec","maxConcurrent":4,"maxConcurrentPerRepo":2,"affinityWindowMs":300000,"claimRetryAfterMs":30000,"gateTimeoutMs":120000,"defaultModelTier":"sonnet","maxInvocationsPerEntity":50},"states":[{"name":"spec","agentRole":"architect","modelTier":"sonnet","mode":"active","promptTemplate":"..."},{"name":"done","mode":"passive"}],"gates":[{"name":"spec-posted","type":"primitive","primitiveOp":"issue_tracker.comment_exists","primitiveParams":{"issueNumber":"{{entity.artifacts.issueNumber}}","pattern":"## Implementation Spec"},"timeoutMs":120000,"failurePrompt":"...","timeoutPrompt":"..."}],"transitions":[{"fromState":"spec","toState":"code","trigger":"spec_ready","priority":0}],"gateWiring":{"spec-posted":{"fromState":"spec","trigger":"spec_ready"}}}

After the FLOW_DESIGN block, output a DESIGN_NOTES: line explaining what you adapted and why:

DESIGN_NOTES:Removed docs state because docs.supported is false. Increased ci-green timeout to 600s because CI has 6 required checks. Added biome lint instructions to code prompt. Used haiku for merge since this repo has a simple merge queue setup.

## Complete Example

Here is a complete, well-designed flow for a TypeScript repo with: CI (GitHub Actions), vitest, biome linting, no docs, no review bots, merge queue enabled. Study this example — your output should be this thorough.

FLOW_DESIGN:{"flow":{"name":"engineering","description":"Engineering flow for acme/api — TypeScript API with biome, vitest, GitHub Actions CI, and merge queue. No docs infrastructure. Gates enforce CI green and spec posted.","initialState":"spec","maxConcurrent":4,"maxConcurrentPerRepo":2,"affinityWindowMs":300000,"claimRetryAfterMs":30000,"gateTimeoutMs":120000,"defaultModelTier":"sonnet","maxInvocationsPerEntity":50},"states":[{"name":"spec","agentRole":"architect","modelTier":"sonnet","mode":"active","promptTemplate":"You are an architect. Read the codebase, analyze the issue, and write a detailed implementation spec.\\n\\n## Issue\\n#{{entity.artifacts.issueNumber}}: {{entity.artifacts.issueTitle}}\\n\\n{{entity.artifacts.issueBody}}\\n\\n## Repo\\nacme/api — TypeScript API\\n\\n## Conventions\\n- Conventional commits (feat:, fix:, chore:)\\n- biome for lint and format\\n- All imports sorted: external → parent → sibling\\n- Tests colocated in tests/ mirroring src/ structure\\n\\n## Instructions\\n1. Read the codebase thoroughly. Understand existing patterns, architecture, and conventions.\\n2. Identify which files to create, modify, or delete.\\n3. Specify function signatures, data structures, and test cases.\\n4. Consider edge cases, error handling, and security implications.\\n5. Post the spec as a comment on the issue starting with \\"## Implementation Spec\\".\\n6. When done, output the following signal on a line by itself:\\n\\nspec_ready"},{"name":"code","agentRole":"coder","modelTier":"sonnet","mode":"active","promptTemplate":"You are a software engineer. Implement the architect's spec, create a PR, and signal when ready for review.\\n\\n## Issue\\n#{{entity.artifacts.issueNumber}}: {{entity.artifacts.issueTitle}}\\n\\n## Architect's Spec\\n{{entity.artifacts.architectSpec}}\\n\\n{{#if entity.artifacts.gate_failures}}\\n## Prior Gate Failures — Fix These First\\n{{#each entity.artifacts.gate_failures}}\\n- Gate: {{this.gateName}} — {{this.output}}\\n{{/each}}\\n{{/if}}\\n\\n## CI Gate — Run Before Pushing\\npnpm lint && pnpm build && pnpm test\\n\\nAll three must pass. biome handles lint and format. vitest runs tests with coverage threshold at 98%.\\n\\n## Instructions\\n1. Follow the architect's spec precisely.\\n2. Write clean, well-tested code following existing patterns.\\n3. Use conventional commits: feat:, fix:, chore:.\\n4. Run the full CI gate locally before pushing.\\n5. Create a PR with a clear description linking the issue.\\n6. When done, output the following signal on a line by itself:\\n\\npr_created"},{"name":"review","agentRole":"reviewer","modelTier":"sonnet","mode":"active","promptTemplate":"You are a code reviewer. Check the PR for correctness, security, and quality.\\n\\n## PR\\n{{entity.artifacts.prUrl}} (#{{entity.artifacts.prNumber}})\\n\\n## Issue\\n#{{entity.artifacts.issueNumber}}: {{entity.artifacts.issueTitle}}\\n\\n## Architect's Spec\\n{{entity.artifacts.architectSpec}}\\n\\n## Instructions\\n1. Read the full PR diff.\\n2. Verify the implementation matches the spec.\\n3. Check for: bugs, security issues, missing tests, dead code, import ordering violations.\\n4. Verify test coverage — this repo requires 98% coverage threshold.\\n5. When done, output ONE of these signals on a line by itself:\\n\\nclean\\n\\nIf there are issues, list every finding with file, line, and description, then output:\\n\\nissues\\n\\nIf CI failed, output:\\n\\nci_failed"},{"name":"fix","agentRole":"fixer","modelTier":"sonnet","mode":"active","promptTemplate":"You are a software engineer. Fix every issue found during review.\\n\\n## PR\\n{{entity.artifacts.prUrl}} (#{{entity.artifacts.prNumber}})\\n\\n{{#if entity.artifacts.reviewFindings}}\\n## Review Findings — Fix All of These\\n{{entity.artifacts.reviewFindings}}\\n{{/if}}\\n\\n{{#if entity.artifacts.gate_failures}}\\n## Gate Failures\\n{{#each entity.artifacts.gate_failures}}\\n- {{this.gateName}}: {{this.output}}\\n{{/each}}\\n{{/if}}\\n\\n## CI Gate — Run Before Pushing\\npnpm lint && pnpm build && pnpm test\\n\\n## Instructions\\n1. Fix every finding. Do not skip any.\\n2. Run the full CI gate locally before pushing.\\n3. Push to the same branch.\\n4. When done, output the following signal on a line by itself:\\n\\nfixes_pushed\\n\\nIf a finding contradicts the architect's spec, output instead:\\n\\ncant_resolve"},{"name":"learning","agentRole":"learner","modelTier":"haiku","mode":"active","promptTemplate":"You are a learning agent. Extract patterns from this completed work.\\n\\n## Issue\\n#{{entity.artifacts.issueNumber}}: {{entity.artifacts.issueTitle}}\\n\\n## What Happened\\n- Spec: {{entity.artifacts.architectSpec}}\\n- PR: {{entity.artifacts.prUrl}}\\n\\n## Instructions\\n1. What patterns or conventions did this work establish or reinforce?\\n2. Were there any surprising findings during review?\\n3. What would make similar future work faster or more reliable?\\n4. If new conventions were established, note them for CLAUDE.md.\\n5. When done, output the following signal on a line by itself:\\n\\nlearned"},{"name":"merge","agentRole":"merger","modelTier":"haiku","mode":"active","promptTemplate":"You are a merge agent. Merge the PR via the merge queue.\\n\\n## PR\\n{{entity.artifacts.prUrl}} (#{{entity.artifacts.prNumber}})\\n\\n## Instructions\\n1. Verify the PR is mergeable (no conflicts, CI green, reviews approved).\\n2. This repo uses a merge queue. Run: gh pr merge --auto\\n3. If the merge queue rejects (DIRTY status), rebase and force-push, then re-enqueue.\\n4. When done, output ONE of these signals on a line by itself:\\n\\nmerged\\n\\nIf blocked (queue rejected, conflicts), output:\\n\\nblocked\\n\\nIf PR was closed without merge, output:\\n\\nclosed"},{"name":"done","mode":"passive"},{"name":"stuck","mode":"passive"},{"name":"cancelled","mode":"passive"},{"name":"budget_exceeded","mode":"passive"}],"gates":[{"name":"spec-posted","type":"primitive","primitiveOp":"issue_tracker.comment_exists","primitiveParams":{"issueNumber":"{{entity.artifacts.issueNumber}}","pattern":"## Implementation Spec"},"timeoutMs":120000,"failurePrompt":"The spec gate checked for a comment starting with \\"## Implementation Spec\\" on issue #{{entity.artifacts.issueNumber}} and did not find one. Post the spec as a comment on the issue. The comment MUST start with the exact heading \\"## Implementation Spec\\".","timeoutPrompt":"The spec gate timed out. The GitHub API may be slow. Try posting the spec comment again."},{"name":"ci-green","type":"primitive","primitiveOp":"vcs.ci_status","primitiveParams":{"ref":"{{entity.artifacts.headSha}}"},"timeoutMs":600000,"failurePrompt":"CI checks failed on PR #{{entity.artifacts.prNumber}}. Check the failing runs, fix the issues, and push again. The CI gate for this repo is: pnpm lint && pnpm build && pnpm test","timeoutPrompt":"CI checks are still running after 10 minutes. They may be queued. The pipeline will retry.","outcomes":{"passed":{"proceed":true},"pending":{"toState":"review"},"failed":{"toState":"fix"}}},{"name":"pr-mergeable","type":"primitive","primitiveOp":"vcs.pr_status","primitiveParams":{"pullNumber":"{{entity.artifacts.prNumber}}"},"timeoutMs":120000,"failurePrompt":"PR #{{entity.artifacts.prNumber}} is not mergeable. Check for conflicts or failing required checks.","outcomes":{"merged":{"proceed":true},"mergeable":{"proceed":true},"blocked":{"toState":"fix"},"closed":{"toState":"stuck"}}}],"transitions":[{"fromState":"spec","toState":"code","trigger":"spec_ready","priority":0},{"fromState":"code","toState":"review","trigger":"pr_created","priority":0},{"fromState":"review","toState":"learning","trigger":"clean","priority":0},{"fromState":"review","toState":"fix","trigger":"issues","priority":0},{"fromState":"review","toState":"fix","trigger":"ci_failed","priority":0},{"fromState":"fix","toState":"review","trigger":"fixes_pushed","priority":0},{"fromState":"fix","toState":"stuck","trigger":"cant_resolve","priority":0},{"fromState":"learning","toState":"merge","trigger":"learned","priority":0},{"fromState":"merge","toState":"done","trigger":"merged","priority":0},{"fromState":"merge","toState":"fix","trigger":"blocked","priority":0},{"fromState":"merge","toState":"stuck","trigger":"closed","priority":0}],"gateWiring":{"spec-posted":{"fromState":"spec","trigger":"spec_ready"},"ci-green":{"fromState":"code","trigger":"pr_created"},"pr-mergeable":{"fromState":"merge","trigger":"merged"}}}
DESIGN_NOTES:Removed docs state — docs.supported is false, so review(clean) transitions directly to learning. Kept all three gates. CI gate timeout set to 600s (10 min) for GitHub Actions. Code and fix prompts include the exact CI gate command (pnpm lint && pnpm build && pnpm test). Merge prompt instructs use of merge queue (gh pr merge --auto) since hasMergeQueue is true. Review prompt checks for 98% coverage threshold. All prompts reference biome and conventional commits per repo conventions.

flow_design_complete`;

export interface FlowDesignOutput {
  flow: {
    name: string;
    description: string;
    initialState: string;
    maxConcurrent?: number;
    maxConcurrentPerRepo?: number;
    affinityWindowMs?: number;
    claimRetryAfterMs?: number;
    gateTimeoutMs?: number;
    defaultModelTier?: string;
    maxInvocationsPerEntity?: number;
  };
  states: Array<{
    name: string;
    agentRole?: string;
    modelTier?: string;
    mode?: string;
    promptTemplate?: string;
  }>;
  gates: Array<{
    name: string;
    type: string;
    primitiveOp?: string;
    primitiveParams?: Record<string, unknown>;
    timeoutMs?: number;
    failurePrompt?: string;
    timeoutPrompt?: string;
    outcomes?: Record<string, { proceed?: boolean; toState?: string }>;
  }>;
  transitions: Array<{
    fromState: string;
    toState: string;
    trigger: string;
    priority?: number;
  }>;
  gateWiring: Record<string, { fromState: string; trigger: string }>;
}

export interface FlowDesignResult {
  design: FlowDesignOutput;
  notes: string;
}

/**
 * Render the flow design prompt with repo-specific context.
 */
export function renderFlowDesignPrompt(repoFullName: string, config: RepoConfig): string {
  return FLOW_DESIGN_PROMPT.replace("{{repoFullName}}", repoFullName).replace(
    "{{repoConfigJson}}",
    JSON.stringify(config, null, 2),
  );
}

/**
 * Parse the AI's flow design output into structured data.
 */
export function parseFlowDesignOutput(output: string): FlowDesignResult {
  const lines = output.split("\n");

  let design: FlowDesignOutput | null = null;
  let notes = "";

  for (const line of lines) {
    if (line.startsWith("FLOW_DESIGN:")) {
      const json = line.slice("FLOW_DESIGN:".length).trim();
      design = JSON.parse(json) as FlowDesignOutput;
    } else if (line.startsWith("DESIGN_NOTES:")) {
      notes = line.slice("DESIGN_NOTES:".length).trim();
    }
  }

  if (!design) {
    throw new Error("Flow design output missing FLOW_DESIGN line");
  }

  // Validate required fields
  if (!design.flow?.name || !design.flow?.initialState) {
    throw new Error("Flow design missing required flow.name or flow.initialState");
  }
  if (!design.states || design.states.length === 0) {
    throw new Error("Flow design missing states");
  }
  if (!design.transitions || design.transitions.length === 0) {
    throw new Error("Flow design missing transitions");
  }

  // Ensure terminal states exist
  const stateNames = new Set(design.states.map((s) => s.name));
  for (const terminal of ["done", "stuck", "cancelled", "budget_exceeded"]) {
    if (!stateNames.has(terminal)) {
      design.states.push({ name: terminal, mode: "passive" });
    }
  }

  return { design, notes };
}
