# Phase 2: New Primitive Ops — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 new GitHub primitive gate ops so all engineering flow transitions can be gate-driven instead of relying on agent signal strings.

**Architecture:** New functions in `primitive-ops.ts`, new cases in the `primitiveOpHandler` switch in `index.ts`, new gate definitions in `engineering.ts`. Same pattern as Phase 1.

**Tech Stack:** TypeScript, Vitest, GitHub REST API

---

### Task 1: `vcs.pr_for_branch` — detect PR creation

### Task 2: `vcs.pr_review_status` — detect clean vs issues

### Task 3: `vcs.pr_head_changed` — detect fixes pushed

### Task 4: `vcs.files_changed_since` — detect docs committed

### Task 5: Wire all 4 ops into primitiveOpHandler + add gate definitions

### Task 6: Tests + check + push
