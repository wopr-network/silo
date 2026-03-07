# Agentic Engineering SOP

This repo documents agentic engineering as a methodology AND provides WOPR as the reference implementation.

## Structure

- `docs/method/` — THE METHOD. Generic, tool-agnostic principles and patterns. Anyone can adopt this.
- `docs/wopr/` — THE WOPR WAY. 1:1 concrete implementation of every method/ concept.
- `docs/adoption/` — HOW TO ADOPT. Bridge from method/ to your own implementation.
- `src/` — TypeScript source code.
- `tests/` — Test files.
- `drizzle/` — Drizzle ORM migrations.

## The 1:1 Rule

Every document in `method/` MUST have a corresponding document in `wopr/`. Every document in `wopr/` MUST reference back to the principle it implements. If you add a method/ doc without a wopr/ counterpart (or vice versa), the structure is broken.

Key concepts that must appear in both method/ and wopr/ docs:
- **Disciplines**: workers declare a category of work (`engineering`, `devops`, `qa`, `security`), not a task role
- **onEnter hooks**: state setup commands that run before a state becomes claimable
- **Three-outcome gate semantics**: pass (continue), fail (waiting), timeout (check_back)

## Writing Rules

- Documentation lives in `docs/` (method/, wopr/, adoption/ subdirectories). TypeScript project files live at the repo root.
- method/ documents describe WHAT and WHY — never name specific tools (not "use Discord", but "use an event bus").
- wopr/ documents describe HOW with specifics — name the tools, show the configs, link the scripts.
- Conventional commits: `docs: <description>`.
- Keep documents focused. One concept per file. Link between documents, don't duplicate.
- Use ASCII diagrams, not images. The audience includes AI agents that can't see images.
- When referencing a method/ principle from wopr/, use relative links: `[event bus pattern](../../method/pipeline/triggers/event-bus.md)`.
- When referencing a wopr/ implementation from method/, use: `See [WOPR implementation](../../wopr/...)`.

## Gotchas

- **Naming**: REST API and `FlowClaimSchema` use `worker_id` (snake_case), never `workerId` (camelCase) — all docs and code must match.
- **CORS**: `isLoopbackOrigin()` regex must use `https?://` prefix (not just `http://`) to cover both HTTP and SSE/HTTPS transports.
