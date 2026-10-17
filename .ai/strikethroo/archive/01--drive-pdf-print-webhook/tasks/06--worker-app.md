---
id: 6
group: "worker"
dependencies: [1, 3, 4]
status: "completed"
created: 2026-10-17
skills:
  - nodejs
  - typescript
complexity_score: 6
complexity_notes: "Coordinates job state machine, Drive, handlers and lp; all policy lives in shared, so the worker is orchestration plus one small lp helper."
execution_profile: "complex-architecture"
---
# Worker App: Poll Loop, Drive Fetch, CUPS Submission via lp

## Objective
Implement `apps/worker`: a long-running poll loop that claims one due job per tick, fetches it from Drive, enforces the size cap, runs the mimeType handler, submits it with `lp` through a single helper, and applies the shared retry policy; plus `.env.example` and `print-me-worker.service`.

## Skills Required
nodejs, typescript.

## Acceptance Criteria
- [x] Env: `DB_PATH`, `GOOGLE_APPLICATION_CREDENTIALS` (or `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`) path, `CUPS_PRINTER_NAME`, `PRINTER_DEVICE_URI` (documented as used only by the `lpadmin` setup step), `POLL_INTERVAL_MS` (default 10000), `MAX_FILE_BYTES` (default 52428800).
- [x] At startup, any `processing` jobs are reset to `queued`. Each tick picks the oldest `queued` job with `nextAttemptAt <= now`, moves it to `processing` before any work; ticks never overlap; one tick handles at most one job.
- [x] Attempt steps: metadata → reject `size > MAX_FILE_BYTES` (permanent) → handler lookup (unsupported = permanent) → download to a private temp dir (`fs.mkdtemp` under `os.tmpdir()`) → handler → `lp` helper → store `cupsJobId`, `mimeType`, mark `printed`; temp dir always removed in `finally`.
- [x] Failure: increments `attempts`, stores truncated `lastError` (e.g. ≤ 500 chars); permanent errors → `failed` immediately; otherwise shared retry policy → `queued` with backoff `nextAttemptAt`, or `failed` after the 5th attempt. Errors never stop the loop.
- [x] `lp` helper: `execFile('lp', ['-d', printer, ...options, '--', filePath])` (argument array, no shell), parses `request id is <queue>-<n>` to return the job ID; unparseable output throws with the raw output in the message. vitest tests with a stubbed exec cover a valid line and unparseable output.
- [x] `apps/worker/.env.example` with placeholders and a comment per variable; `print-me-worker.service` modelled on screen-time's worker unit (`Restart=always`, `User=print-me`, `/opt/print-me/apps/worker`).
- [x] Verification (local, no printer): run the worker against a temp DB containing a queued job with an invalid key path; move `nextAttemptAt` back with `sqlite3` between ticks (or use a short `POLL_INTERVAL_MS`); confirm `attempts` increments to 5, `lastError` is set and state ends `failed` with no further attempts. `pnpm --filter @print-me/worker test` (or the shared test command, wherever the lp test lives) exits 0; `pnpm run build && pnpm run check && pnpm run format:check` exit 0.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Uses `@print-me/shared` (`initDatabase`, `PrintJob`, retry policy, Drive client, handler registry, `PermanentJobError`).
- Node `child_process.execFile` promisified; `lp` is not installed on the dev VM, so the helper is tested only with a stub.

## Input Dependencies
Task 1 (spike confirms `lp` against the SpliX queue works; read `spike-results.md` for any `lp` option or permission notes), tasks 3 and 4.

## Output Artifacts
Runnable worker, `lp` helper with tests, `.env.example`, systemd unit; referenced by docs (task 8).

## Implementation Notes
<details>
<summary>Guidance</summary>

- Test philosophy (copy for test work): "write a few tests, mostly integration". Test custom business logic, critical workflows, edge cases and error conditions; do **not** test third-party library behaviour, trivial getters/setters, static configuration, or obvious code. Combine related scenarios into a few test files.
- TDD the `lp` parser first: make the helper accept an injectable `exec` function (default: promisified `execFile`). Regex: `/request id is (\S+)-(\d+)/` → return the full `queue-n` string or just `n` (store the full `<queue>-<n>` as `cupsJobId`, since `lpstat`/`cancel` use that form).
- The worker needs a `vitest` dev dep and a `test` script if the lp test lives in `apps/worker`; add it there and make sure the root scripts/Self Validation still work.
- Loop: `setTimeout`-chained ticks (not `setInterval`) so ticks never overlap; handle SIGTERM by stopping the loop and destroying the data source.
- Claim atomically: `UPDATE print_job SET state='processing' WHERE id=? AND state='queued'` and check affected rows.
- Updating job state after `lp` must happen immediately after `lp` returns (duplicate-print trade-off documented in AGENTS.md by task 8).
- Reference screen-time's worker (`gh repo clone m4olivei/screen-time <scratchpad>/screen-time`) for env loading, logging style and the systemd unit.
</details>
