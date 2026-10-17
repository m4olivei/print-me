---
id: 4
group: "shared"
dependencies: [2, 3]
status: "completed"
created: 2026-10-17
skills:
  - typeorm
  - sqlite
complexity_score: 6
complexity_notes: "Concurrency-sensitive: partial unique index created with raw SQL, startup assertion, and transactional intake with constraint-error recovery. Kept as one task because index, entity and intake share one correctness contract."
execution_profile: "complex-architecture"
---
# Shared Package: Data Source, PrintJob Entity, Partial Index, Job Intake

## Objective
Add the SQLite/TypeORM layer to `packages/shared`: the data source (WAL, busy timeout), the `PrintJob` entity, the startup step that creates and asserts the partial unique index, and the job-intake function (dedupe → hourly cap → insert, with unique-constraint recovery).

## Skills Required
typeorm, sqlite.

## Acceptance Criteria
- [x] `createDataSource(dbPath)` / `initDatabase(dbPath)` returns an initialised TypeORM `DataSource` on `better-sqlite3` with `synchronize: true`, WAL journal mode and a busy timeout; it creates the parent directory if missing.
- [x] `PrintJob` entity (`print_job` table): generated integer `id`, `url`, `driveFileId`, `state` (`queued | processing | printed | failed`), `attempts` (default 0), `nextAttemptAt`, `lastError` (nullable), `mimeType` (nullable), `cupsJobId` (nullable), `createdAt`, `updatedAt`. The partial index is **not** declared through TypeORM decorators.
- [x] After init, raw SQL runs `CREATE UNIQUE INDEX IF NOT EXISTS <name> ON print_job(driveFileId) WHERE state IN ('queued','processing')`, then `sqlite_master` is queried; if the index is missing, init throws (refuse to start).
- [x] `intakeJob(dataSource, { url, driveFileId, maxJobsPerHour, now? })` runs in one transaction and returns a discriminated union: `{ kind: 'existing', id }` if an active job for the file exists; `{ kind: 'rate-limited', retryAfterSeconds }` if jobs created in the last hour ≥ cap (`retryAfterSeconds` = seconds until the oldest in-window job turns one hour old, rounded up, min 1); else `{ kind: 'created', id }` for a new `queued` job with `nextAttemptAt = now`. On `SQLITE_CONSTRAINT_UNIQUE` during insert it re-reads the active job and returns `existing`; any other error propagates. Dedupe is checked before the cap.
- [x] vitest integration tests against a temp SQLite file cover: index present in `sqlite_master` after init; a second active row for the same `driveFileId` inserted directly fails with `SQLITE_CONSTRAINT_UNIQUE`; dedupe while `queued`/`processing`; a new job after `printed`/`failed`; the hourly cap with correct `retryAfterSeconds`; a deduped request does not count toward the cap; intake recovers from a constraint error by returning the existing id.
- [x] Verification: `pnpm --filter @print-me/shared test` exits 0; `pnpm run build && pnpm run check && pnpm run format:check` exit 0.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- Dependencies in `packages/shared`: `typeorm`, `better-sqlite3`, `reflect-metadata`.
- Entities under `packages/shared/src/db/entities/` (screen-time convention). Store timestamps so that "created in the last hour" comparisons are correct in SQLite (use `datetime` columns via TypeORM and pass `Date` parameters, or store epoch ms integers — pick one and use it consistently).

## Input Dependencies
Task 2 workspace skeleton; task 3 (runs first so the two tasks never edit `packages/shared/package.json`, the entry point or `pnpm-lock.yaml` concurrently).

## Output Artifacts
`initDatabase`, `PrintJob`, `JobState`, `intakeJob` exported from `@print-me/shared`, consumed by web (task 5) and worker (task 6).

## Implementation Notes
<details>
<summary>Guidance</summary>

- Test philosophy (copy for test work): "write a few tests, mostly integration". Test custom business logic, critical workflows, edge cases and error conditions; do **not** test third-party library behaviour, trivial getters/setters, static configuration, or obvious code. Combine related scenarios into a few test files.
- Follow TDD: start with the failing "index exists after init" test.
- Look at `m4olivei/screen-time` `packages/shared/src/db/` (`gh repo clone m4olivei/screen-time <scratchpad>/screen-time`) for the data-source pattern (WAL pragma, busy timeout via `prepareDatabase` or `PRAGMA busy_timeout`).
- Constraint-recovery test: the race can be simulated by calling the insert path with a dedupe lookup that is bypassed (e.g. an internal option or by inserting an active row through raw SQL between steps via a test hook), or by asserting on a helper `insertOrRecover` that receives the conflict. Keep any test seam internal and minimal.
- Detect the error via `err.code === 'SQLITE_CONSTRAINT_UNIQUE'` (better-sqlite3), possibly wrapped by TypeORM in `QueryFailedError` (`err.driverError?.code`). Check both.
- Note: when the transaction aborts on the constraint error, do the re-read in a fresh query outside the failed transaction.
- `retryAfterSeconds = max(1, ceil((oldestCreatedAt + 3600s - now) / 1000))`.
- Keep TypeORM column names exactly as the field names (camelCase) so `sqlite3` queries in validation use `driveFileId`.
</details>
