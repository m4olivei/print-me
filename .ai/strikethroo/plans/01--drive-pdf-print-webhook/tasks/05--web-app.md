---
id: 5
group: "web"
dependencies: [3, 4]
status: "pending"
created: 2026-10-17
skills:
  - fastify
  - typescript
complexity_score: 5
execution_profile: "complex-architecture"
---
# Web App: Fastify Webhook and Status API

## Objective
Implement `apps/web`: a Fastify server bound to `127.0.0.1` exposing `POST /print`, `GET /print/:id` and `GET /healthz` per the plan's Data Contract, plus its `.env.example` and `print-me-web.service` systemd unit.

## Skills Required
fastify, typescript.

## Acceptance Criteria
- [ ] Env: `DB_PATH` (required), `PORT` (default distinct from 3000, e.g. `3100`), `MAX_JOBS_PER_HOUR` (default 20). Listens on host `127.0.0.1` only.
- [ ] `POST /print`: Fastify JSON schema requires a single `url` string (empty/missing body → 400); unrecognised Drive link → 400; intake `existing` → `200 { id }`; `rate-limited` → `429` with `Retry-After: <n>` header and body `{ error, retryAfterSeconds: n }`; `created` → `202 { id }`.
- [ ] `GET /print/:id` → `200 { id, state, attempts, lastError, cupsJobId, createdAt, updatedAt }` or `404`.
- [ ] `GET /healthz` runs `SELECT 1` and returns `200 { ok: true }`.
- [ ] Uses Fastify's built-in logger to stdout. Does not import the Drive client or call CUPS.
- [ ] `apps/web/.env.example` documents each variable with a comment and placeholder values.
- [ ] `apps/web/deploy/print-me-web.service` (or the location screen-time uses) modelled on screen-time's web unit: `User=print-me`, `WorkingDirectory=/opt/print-me/apps/web`, `EnvironmentFile=/opt/print-me/apps/web/.env`, runs the built `dist`, hardened.
- [ ] Verification (local smoke test, run and recorded): start with a temp `DB_PATH`, then `curl` checks: valid POST → 202; invalid URL → 400; empty body → 400; same URL again → 200 same id and `sqlite3 <db> 'select count(*) from print_job'` = 1; `GET /print/<id>` → `state: "queued"`; `GET /print/999999` → 404; `/healthz` → 200; `sqlite3 <db> '.indexes print_job'` lists the partial index; `ss -ltnp` shows `127.0.0.1:<port>` only; restart with `MAX_JOBS_PER_HOUR=2` and fresh DB, two different URLs → 202, third → 429 with matching `Retry-After` and `retryAfterSeconds`.
- [ ] `pnpm run build && pnpm run check && pnpm run format:check` exit 0.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- `fastify` dependency in `apps/web`; `@print-me/shared` via `workspace:*`; `reflect-metadata` imported at entry.
- Load `.env` the way screen-time's apps do (e.g. Node's `--env-file-if-exists` or `process.loadEnvFile`), no extra dotenv dependency unless screen-time uses one.

## Input Dependencies
Tasks 3 (`parseDriveFileId`) and 4 (`initDatabase`, `intakeJob`, `PrintJob`).

## Output Artifacts
Runnable web app, `.env.example`, systemd unit; referenced by docs (task 8) and infra (task 7 uses the port).

## Implementation Notes
<details>
<summary>Guidance</summary>

- Reference: `gh repo clone m4olivei/screen-time <scratchpad>/screen-time`; read its web systemd unit and env-loading approach and mirror them (location of unit files, hardening directives).
- Build the app as `buildApp(dataSource, config)` returning a Fastify instance plus a `main()` that listens, so the smoke test (and any future test) can use it. No new unit tests are required here: route behaviour is covered by the smoke test and intake logic is tested in task 4.
- Map `Retry-After` header value to a string of the same integer as `retryAfterSeconds`.
- Serialise dates as ISO strings.
- `sqlite3` CLI may not be installed; if absent, install it (`sudo apt-get install -y sqlite3`) or query via a short `node -e` with `better-sqlite3`.
</details>
