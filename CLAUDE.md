# Agentic Engineering SOP

This repo documents agentic engineering as a methodology AND provides WOPR as the reference implementation.

## Structure

- `method/` — THE METHOD. Generic, tool-agnostic principles and patterns. Anyone can adopt this.
- `wopr/` — THE WOPR WAY. 1:1 concrete implementation of every method/ concept.
- `adoption/` — HOW TO ADOPT. Bridge from method/ to your own implementation.

## The 1:1 Rule

Every document in `method/` MUST have a corresponding document in `wopr/`. Every document in `wopr/` MUST reference back to the principle it implements. If you add a method/ doc without a wopr/ counterpart (or vice versa), the structure is broken.

## Writing Rules

- No files in the repo root except CLAUDE.md, README.md, and LICENSE.
- method/ documents describe WHAT and WHY — never name specific tools (not "use Discord", but "use an event bus").
- wopr/ documents describe HOW with specifics — name the tools, show the configs, link the scripts.
- Conventional commits: `docs: <description>`.
- Keep documents focused. One concept per file. Link between documents, don't duplicate.
- Use ASCII diagrams, not images. The audience includes AI agents that can't see images.
- When referencing a method/ principle from wopr/, use relative links: `[event bus pattern](../../method/pipeline/triggers/event-bus.md)`.
- When referencing a wopr/ implementation from method/, use: `See [WOPR implementation](../../wopr/...)`.
