# DEFCON Onboarding — The WOPR Implementation

> For new contributors, operators, and AI agents setting up or debugging the DEFCON service.

---

## What DEFCON Is

DEFCON is the flow engine. It persists entity state in SQLite, runs `onEnter` hooks when entities enter new states, evaluates gates on transitions, and serves a REST API for workers to claim and report on work.

DEFCON is stateless in memory — restart it and it picks up from the database exactly where it left off. Workers (RADAR) connect to it over HTTP.

---

## Quick Start (Docker)

The fastest way to run DEFCON is with the published npm package inside Docker.

### 1. Create a `Dockerfile.defcon`

```dockerfile
FROM node:24-alpine
RUN apk add --no-cache git
RUN npm install -g pnpm @wopr-network/defcon@latest
ENV CLI=/usr/local/lib/node_modules/@wopr-network/defcon/dist/src/execution/cli.js
WORKDIR /app
CMD sh -c "node $CLI init --seed /app/seed/flows.json --db /data/defcon.db && node $CLI serve --http-only --http-host 0.0.0.0 --http-port 3001 --db /data/defcon.db"
```

**Why `git`?** The `provision-worktree` CLI command calls git directly. Without it the command fails with `spawnSync git ENOENT`.

**Why `pnpm`?** Worktree provisioning runs `pnpm install` in the cloned repo. Without pnpm the install step fails.

### 2. Write a seed file

See `seeds/wopr-changeset.json` for a full example. Minimum structure:

```json
{
  "flows": [{ "name": "my-flow", "discipline": "engineering", "initialState": "working" }],
  "states": [{ "name": "working", "flowName": "my-flow", "mode": "active", "promptTemplate": "..." }],
  "gates": [],
  "transitions": [{ "flowName": "my-flow", "fromState": "working", "toState": "done", "trigger": "done" }]
}
```

### 3. Run

```bash
docker compose up defcon
```

### 4. Verify healthy

```bash
curl http://localhost:3001/api/status
# → {"flows":{...},"activeInvocations":0,"pendingClaims":0}
```

---

## Creating a Test Entity

```bash
curl -X POST http://localhost:3001/api/entities \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DEFCON_ADMIN_TOKEN" \
  -d '{
    "flowName": "my-flow",
    "refs": {
      "linear": { "id": "abc-123", "key": "WOP-001", "title": "Test", "description": "**Repo:** myorg/myrepo" },
      "github": { "repo": "myorg/myrepo" }
    }
  }'
```

After creation, watch for the `onEnter` to complete:

```bash
# Poll status — pendingClaims should go from 0 to 1 once onEnter finishes
curl http://localhost:3001/api/status

# Check entity directly
curl http://localhost:3001/api/entities/<entity-id>
```

Once `pendingClaims: 1` appears, a worker can claim the entity.

---

## Reading the Status Endpoint

`GET /api/status` is the primary health signal:

```json
{
  "flows": {
    "<flow-id>": { "architecting": 1, "coding": 0, "done": 2 }
  },
  "activeInvocations": 1,
  "pendingClaims": 0
}
```

| Field | Meaning |
|-------|---------|
| State counts | How many entities are in each state |
| `activeInvocations` | Workers have claimed and are actively processing |
| `pendingClaims` | Entities ready to be claimed (onEnter complete, not yet claimed) |

**Healthy pipeline:** `pendingClaims` rises after entity creation, then drops to 0 when a worker claims it. `activeInvocations` rises by 1. When the worker reports, `activeInvocations` drops.

---

## onEnter Hooks

onEnter commands run shell commands before a state becomes claimable. Stdout must be a JSON object containing the keys listed in `artifacts`.

### stdout contamination

If the command involves `npm install`, `pnpm install`, or similar, their output will contaminate stdout and break JSON parsing. Fix: pipe through a tail-scanner that searches from the end of output for the first valid JSON line:

```bash
my-command | node -e "
let d='';
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  const lines = d.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    try { const r = JSON.parse(lines[i]); process.stdout.write(JSON.stringify(r)); return; }
    catch(e) {}
  }
  process.exit(1);
});
"
```

This is already used in `seeds/wopr-changeset.json`'s `architecting` state.

---

## Gates

Gates are shell scripts run on transitions. They block the transition until the script exits 0.

- Exit 0 → gate passes, entity advances
- Non-zero exit → gate fails, `failurePrompt` is injected into the next agent invocation
- Timeout → `timeoutPrompt` is injected

Gate scripts live in `gates/` and are referenced by name in the seed file. See `docs/wopr/gates/gate-scripts.md` for the full list.

---

## Common Problems

### `onEnter.failed` — `spawnSync git ENOENT`

`git` is not installed in the container. Add `apk add --no-cache git` to the Dockerfile.

### `onEnter.failed` — `pnpm: not found`

`pnpm` is not installed. Add `npm install -g pnpm` to the Dockerfile.

### `pendingClaims` stays at 0 after entity creation

The `onEnter` hook is still running (or failed silently). Check the entity directly:

```bash
curl http://localhost:3001/api/entities/<id>
```

Look for `onEnter_error` in `artifacts`. If present, the command failed — the error text is in `onEnter_error.error`.

### Entity stuck in claimed state, no worker active

A worker claimed the entity but crashed before reporting. The entity holds a `claimedAt` timestamp but no `completedAt`. DEFCON will eventually time out the claim (configurable). To manually unstick:

```bash
curl -X POST http://localhost:3001/api/entities/<id>/report \
  -H "Authorization: Bearer $DEFCON_ADMIN_TOKEN" \
  -d '{"signal":"crash","artifacts":{"error":"manual unstick"}}'
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DEFCON_DB_PATH` | yes | Path to SQLite database file |
| `DEFCON_ADMIN_TOKEN` | yes | Bearer token for admin API calls |
| `DEFCON_WORKER_TOKEN` | yes | Bearer token for worker claim/report calls |
| `DEFCON_SEED_ROOT` | no | Root path for gate script resolution (default: `/`) |
| `DEFCON_CORS_ORIGIN` | no | Allowed CORS origin for browser clients |

---

## Further Reading

- [onEnter hooks](../pipeline/onenter-hooks.md) — full schema and behavior
- [Gate scripts](../gates/gate-scripts.md) — available gates and how to write new ones
- [Worker protocol](../pipeline/worker-protocol.md) — how workers claim and report
- [Operations](./operations.md) — production deploy, rollback, and health check procedures
