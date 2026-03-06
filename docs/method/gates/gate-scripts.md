# Gate Scripts

Synchronization primitives — deterministic scripts that block progress until conditions are met.

---

## What is a Gate Script?

A gate script is a blocking program that:

1. Checks a condition repeatedly
2. Exits successfully when the condition is met
3. Exits with failure after a timeout
4. Produces structured output indicating the result

Gate scripts are the building blocks of deterministic gates. They turn "wait for X" into a concrete, automatable action.

## The Pattern

```
┌─────────────────────────────────────┐
│  Gate Script                        │
│                                     │
│  loop:                              │
│    check condition                  │
│    if met → exit 0 (pass)           │
│    if timeout → exit 1 (fail)       │
│    sleep interval                   │
│    repeat                           │
│                                     │
│  stdout: structured result          │
│  stderr: progress/debug info        │
└─────────────────────────────────────┘
```

### Properties

- **Deterministic**: Same inputs → same behavior
- **Blocking**: The caller waits for the script to exit
- **Timeout-bounded**: Never runs forever
- **Structured output**: Machine-parseable result on stdout
- **Idempotent**: Safe to run multiple times

## Common Gate Scripts

### Review Bot Synchronization

**Problem**: Multiple review bots post comments on a PR asynchronously. If the reviewer starts before all bots have posted, it misses findings.

**Solution**: A gate script that blocks until all configured bots have posted, or a timeout expires.

```
Input: PR number, repo, list of expected bots
Behavior:
  - Poll PR comments every 30 seconds
  - Check if each expected bot has posted at least one comment
  - When all have posted → exit 0, print all comments
  - After timeout → exit 0, print "TIMEOUT: <missing bots>"
  - (Timeout is a soft failure — proceed anyway, note which bots didn't post)
Output:
  - All PR comments from all three feeds (inline, reviews, top-level)
  - List of which bots posted and which timed out
```

### Merge Queue Watcher

**Problem**: After queueing a PR for merge, the system needs to know when it actually merges (or gets ejected).

**Solution**: A gate script that polls PR status until it resolves.

```
Input: PR number, repo
Behavior:
  - Poll PR status every 30 seconds
  - If state is MERGED → exit 0, print "MERGED"
  - If state is CLOSED → exit 1, print "CLOSED"
  - If CI is failing → exit 1, print "BLOCKED: <failing checks>"
  - After timeout → exit 1, print "TIMEOUT"
Output:
  - Single-line result: MERGED, CLOSED, BLOCKED, or TIMEOUT
  - For BLOCKED: names of failing checks
```

### CI Check Waiter

**Problem**: CI checks run asynchronously. The reviewer needs to know if CI is passing before reviewing code.

**Solution**: A gate script that blocks until all CI checks complete.

```
Input: PR number, repo
Behavior:
  - Poll check status every 15 seconds
  - If all checks pass → exit 0
  - If any check fails → exit 1, print failing check names
  - After timeout → exit 1, print "TIMEOUT: checks still running"
Output:
  - Pass: list of all passing checks
  - Fail: list of failing checks with their status
```

### Health Check Gate

**Problem**: After a deploy, the system needs to verify the service is healthy before declaring success.

**Solution**: A gate script that polls the health endpoint.

```
Input: health endpoint URL, expected status code
Behavior:
  - Hit the health endpoint every 5 seconds
  - If status code matches expected → exit 0
  - After timeout → exit 1, print "UNHEALTHY"
Output:
  - Pass: response body
  - Fail: last response status and body
```

## Design Principles

### 1. Output is Structured

Gate scripts print machine-parseable output on stdout. The calling agent parses this output to determine next steps.

Good: `MERGED: PR #42 merged at 2024-01-15T14:32:00Z`
Bad: `The PR has been successfully merged into the main branch.`

### 2. Timeouts are Mandatory

Every gate script has a maximum runtime. Without timeouts, a gate script can block the pipeline forever.

Choose timeouts based on the expected duration:
- Review bot posting: 5-10 minutes
- Merge queue processing: 15-30 minutes
- CI checks: 10-20 minutes
- Health checks: 2-5 minutes

### 3. Failure is Informative

When a gate script fails, it prints exactly what went wrong:
- Which condition wasn't met
- What the current state is
- What was expected

This information feeds directly into the fixer's assignment.

### 4. Progress is Visible

Gate scripts print progress to stderr so the calling agent (and human observers) can see what's happening:

```
stderr: Waiting for review bots... (0/3 posted)
stderr: Waiting for review bots... (1/3 posted: CodeRabbit)
stderr: Waiting for review bots... (2/3 posted: CodeRabbit, Qodo)
stderr: All bots posted. (3/3)
stdout: <structured comments output>
```

### 5. Interval is Respectful

Don't poll every second. External APIs have rate limits. Choose an interval that balances responsiveness with politeness:

| Check Type | Recommended Interval |
|-----------|---------------------|
| CI checks | 15-30 seconds |
| Review bot comments | 30-60 seconds |
| Merge queue status | 30-60 seconds |
| Health endpoint | 5-10 seconds |
| Deploy status | 10-15 seconds |

## Composing Gate Scripts

Gate scripts can be chained:

```
1. Wait for CI → exit 0
2. Wait for review bots → exit 0
3. Agent reviews the diff
4. Wait for merge queue → exit 0
5. Wait for health check → exit 0
```

Each gate blocks until its condition is met. The pipeline advances only when each gate passes in sequence.

## Anti-Patterns

- **No timeout** — a gate script that runs forever if the condition is never met. Always set a maximum runtime.
- **Unstructured output** — printing human-readable prose instead of machine-parseable results. Agents can't parse prose reliably.
- **Polling too fast** — hitting an API every second. You'll get rate-limited and banned.
- **Silent failure** — exiting with code 0 even when the condition wasn't met. A soft timeout should still communicate what timed out.
- **Side effects** — a gate script that modifies state (posts comments, creates branches). Gate scripts check conditions; they don't change them.
