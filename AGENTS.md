# AGENTS.md — guidance for AI-assisted work in this repo

Read this before changing anything. It records the architecture, the binding invariants, and the
technology decisions that were deliberately locked during planning — do not relitigate them.

## What this is

A print webhook: an AI agent saves a PDF to a shared Google Drive folder and POSTs its link to
`apps/web` (Fastify), which queues a job in SQLite. A systemd-managed poll worker (`apps/worker`)
on a Raspberry Pi downloads the file from Drive as a service account and submits it to a local CUPS
queue (SpliX driver) for a Samsung SCX-4623FW. Cloudflare Tunnel + Access publishes the webhook. See
`README.md` for setup and operations.

## Monorepo layout

```
apps/
  web/            Fastify webhook (src/app.ts routes, src/config.ts env, src/index.ts boot).
                  POST /print, GET /print/:id, GET /healthz. Reads/writes SQLite only. Binds
                  127.0.0.1. print-me-web.service is the systemd unit.
  worker/         Poll loop (src/index.ts, one job per tick in src/jobs.ts). Drive metadata ->
                  size cap -> handler lookup -> download to a private temp dir -> handler ->
                  `lp` (src/lp.ts, the only place `lp` is called). print-me-worker.service is
                  the systemd unit.
packages/
  shared/         @print-me/shared: the TypeORM data source + PrintJob entity (src/db/), job
                  intake (src/db/intake.ts), Drive URL parsing (src/drive/url.ts), the Drive
                  client (src/drive/client.ts), the retry policy (src/retry.ts), job error types
                  (src/errors.ts) and the document-type handler registry (src/handlers/).
infra/
  cloudflare/     OpenTofu config for the Cloudflare Tunnel + Access setup that publishes the
                  web app (tunnel + ingress, proxied DNS record, Access app, service token and
                  service-auth policy) and print-me-tunnel.service. Applied by hand; state is
                  local and git-ignored.
  google/         OpenTofu config for the worker's Google identity: Drive and IAM APIs, the
                  service account and its JSON key, in an existing project. Drive folder sharing
                  is manual (Drive data, not a Google Cloud resource). Own local, git-ignored state.
```

## Invariants (binding)

- **The web app touches only SQLite.** It never calls Google Drive or CUPS. (Importing
  `@print-me/shared` in web does load the Drive client module, because shared has one barrel
  export; web never calls it.)
- **The worker is the sole caller of Google Drive and CUPS**, and the sole caller of `lp`, through
  the one helper `submitToCups` in `apps/worker/src/lp.ts`. It runs `lp` with `execFile` and an
  argument array (`lp -d <queue> [opts] -- <file>`), never a shell. Do not add a second call site.
- **SQLite is the only shared state.** Web and worker communicate exclusively through the database
  file (WAL mode); no IPC, HTTP, queue or file signal between them.
- **Authentication is enforced at the Cloudflare edge only.** Access admits a service token and
  returns a plain 401 to everything else. The app has no auth, no sessions, and must not grow any.
  The web app therefore listens on `127.0.0.1`, fixed in code (only `PORT` is configurable): the
  tunnel connector is its only client, and a LAN-facing port would be an unauthenticated way around
  Access. Do not "helpfully" bind `0.0.0.0`.
- **Single authorities in `packages/shared`.** The retry policy (`MAX_ATTEMPTS = 5`, backoff 1/2/4/8
  minutes) lives only in `src/retry.ts` (`computeRetry`). Job intake (dedupe and the hourly cap)
  lives only in `src/db/intake.ts` (`intakeJob`). The document-type handler registry lives only in
  `src/handlers/`. Apps call these; they never re-implement them.
- **Intake owns its transaction.** `intakeJob` runs `BEGIN IMMEDIATE` on the data source's single
  better-sqlite3 connection (serialised per data source), so the web app must not open transactions
  of its own; plain reads are fine.
- **The partial unique index is raw SQL.** `idx_print_job_active_drive_file` (unique on
  `driveFileId` where `state IN ('queued','processing')`) is created by `initDatabase` after the data
  source initialises, and startup refuses to proceed if `sqlite_master` does not list it. The
  `@Index(..., { synchronize: false })` on `PrintJob` is only a marker so `synchronize` does not drop
  the index; it does not create it. Do not move creation into TypeORM.
- **Public repo: placeholders only.** No hostnames, IPs, email addresses, account or zone IDs, folder
  IDs, keys or tokens in tracked files. Examples use `print.example.com`, `<printer-ip>`,
  `<account-id>`, `<zone-id>`.

## Known trade-off: duplicate prints

If `lp` succeeds but the database update that marks the job `printed` fails, the job is retried and
printed twice. The worker updates the row straight after `lp` returns, and the window is accepted as
negligible for this workload. Do not add machinery to close it without asking.

`printed` means accepted by CUPS, not physically printed: CUPS accepts jobs even when the printer
address is wrong.

## Do not add (explicitly out of scope)

Do not add: a status UI, notifications on failure, print options (copies, duplex), document types
other than PDF (until requested; a new type is one registered handler), deleting or moving Drive
files after printing, multiple printers, Docker, any app-level authentication, an `Idempotency-Key`
header, a Cloudflare rate-limit rule, an app-to-worker poke channel, or Drive/CUPS calls from the
web app.

## Locked technology decisions (do not relitigate)

- TypeScript everywhere; Prettier project-wide (`.prettierrc`: tabs, single quotes, no trailing
  commas, width 100); vitest for unit tests; tsx for dev.
- Fastify for the web app, with the built-in pino logger to stdout (journald collects it).
- TypeORM with the `better-sqlite3` driver; entities in `packages/shared/src/db/entities/`; tables
  via `synchronize: true` (greenfield), WAL mode plus a 5 s busy timeout.
- Single pnpm workspace (`pnpm-workspace.yaml`: `packages/*`, `apps/*`), pnpm pinned in
  `packageManager`.
- Printing goes through CUPS with the SpliX driver (`drv:///splix-samsung.drv/scx4623fw.ppd`, device
  `socket://<printer-ip>:9100`); the worker calls `lp` directly. No print library.
- Drive access is a Google service account with the read-only scope, key file outside the checkout.
  The account and key are provisioned with **OpenTofu** in `infra/google/` (provider
  `hashicorp/google` v8, authenticated by `gcloud` Application Default Credentials on the
  workstation).
- Retries: at most 5 attempts in total, backoff 1/2/4/8 minutes; permanent errors (unsupported type,
  file over `MAX_FILE_BYTES`) skip retries.
- Dedupe on `driveFileId` while a job is `queued`/`processing`; hourly cap via `MAX_JOBS_PER_HOUR`
  (429 with `Retry-After` and `retryAfterSeconds`).
- Public exposure and authentication: **Cloudflare Tunnel + Cloudflare Access service token**,
  provisioned with **OpenTofu** in `infra/cloudflare/` (provider `cloudflare/cloudflare` v5). No
  identity provider, no reverse proxy, no router port forward.
- systemd with no Docker, installed under `/opt/print-me` as a loginless `print-me` user. This
  runs beside screen-time on the same Pi with nothing shared at runtime: own tunnel, token file
  (`/etc/cloudflared/print-me.token`), metrics port (20242), web port (3100), SQLite file and
  OpenTofu state.
- Secrets are never committed. The Cloudflare API token lives in `CLOUDFLARE_API_TOKEN`, real values
  in git-ignored `.env` and `terraform.tfvars` files (specs: the `.example` files), the tunnel token in
  `/etc/cloudflared/print-me.token`, the Google key in `/etc/print-me/`. OpenTofu state is local,
  plaintext and git-ignored, and both `infra/cloudflare` and `infra/google` state hold secrets: treat
  them as password files.

## Key semantics

- Job states: `queued`, `processing`, `printed`, `failed`. At worker startup, any job left in
  `processing` by a crash returns to `queued` (safe because there is exactly one worker).
- A tick handles at most one job: the oldest `queued` job whose `nextAttemptAt` has passed, claimed
  by moving it to `processing` before any work.
- `cupsJobId` is stored in full `<queue>-<n>` form (e.g. `scx4623fw-3`), parsed from
  `request id is <queue>-<n> (1 file(s))`. The parser must not anchor on end of line; unparseable
  output fails the attempt.
- `GET /print/:id` with a non-numeric id returns 400 (route schema); an unknown id returns 404.
- `PRINTER_DEVICE_URI` is in the worker `.env` but is read only by the documented `lpadmin` step,
  never by the worker.
- Cloudflare Access is configured with `service_auth_401_redirect = true`, so unauthenticated
  requests get a plain 401, not a redirect or 403.

## Commands

```sh
pnpm install
pnpm run build           # all packages
pnpm run check           # shared build + typecheck everything
pnpm run format          # prettier --write .
pnpm run format:check    # prettier --check .
pnpm --filter @print-me/shared test   # vitest unit tests (URL parsing, retry, intake, index)
pnpm --filter @print-me/worker test   # vitest unit tests (lp helper, job tick)
pnpm --filter @print-me/web dev       # web dev server (tsx watch)
pnpm --filter @print-me/worker dev    # worker with watch/restart
```
