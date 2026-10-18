# print-me

A self-hosted print webhook. An AI agent saves a PDF to a shared Google Drive folder and POSTs its
link to a public webhook; a worker on a Raspberry Pi downloads the file and prints it on a LAN
Samsung SCX-4623FW through CUPS.

## Architecture

Three pieces in one pnpm workspace, joined only by a SQLite file and the local CUPS daemon:

- **`apps/web`** — a Fastify webhook (`POST /print`, `GET /print/:id`, `GET /healthz`). It records
  jobs in SQLite and reports their status. It never calls Google Drive or CUPS, and it listens on
  `127.0.0.1` only.
- **`apps/worker`** — a long-running Node poll loop (systemd-managed). Every `POLL_INTERVAL_MS` it
  handles at most one due job: fetch the file from Drive as a service account, then submit it to a
  CUPS queue with `lp`. It is the only process that calls Drive and CUPS.
- **`packages/shared`** — the TypeORM entity and SQLite data source, job intake (dedupe and the
  hourly cap), Drive URL parsing, the retry policy, the Drive client and the document-type handler
  registry.

```
agent --(Access service token)--> Cloudflare edge --> cloudflared --> web (127.0.0.1:3100)
                                                                        |
                                                                     SQLite
                                                                        |
Drive <-- worker --lp--> CUPS + SpliX --socket (LAN)--> Samsung SCX-4623FW
```

Cloudflare Access is the only authentication layer. The app has none of its own, which is why the
web app binds loopback: the tunnel connector on the same host is its sole client, and a LAN-facing
port would be an unauthenticated way around Access. If the internet or Cloudflare is down, so is
the webhook.

### Job lifecycle

- A job is `queued`, `processing`, `printed` or `failed`.
- **`printed` means CUPS accepted the job** (`lp` returned a job ID, stored as `cupsJobId`, e.g.
  `scx4623fw-3`). It does not mean paper came out: CUPS accepts jobs even when the printer address
  is wrong. Problems after that point show up in CUPS (`lpstat`), not in the job row.
- A job gets **at most 5 attempts** in total (fetch and print together are one attempt), retried
  after 1, 2, 4 and 8 minutes, then marked `failed`. A job that keeps failing therefore reads
  `failed` about 15 minutes after it was queued (attempts at 0, 1, 3, 7 and 15 minutes).
  `attempts` and `lastError` are visible after the first failure.
- An unsupported document type (anything but PDF) or a file over `MAX_FILE_BYTES` fails
  immediately after one attempt, with no retries.
- Only PDF is supported. New types are one handler registered in `packages/shared/src/handlers/`.

## Requirements

- A Raspberry Pi (arm64 Debian) on the same LAN as the printer, with systemd, Node.js 24 LTS and
  pnpm 11 (the repo pins `pnpm@11.20.0` via `packageManager`).
- A Samsung SCX-4623FW with a DHCP reservation (see below).
- CUPS, `cups-filters` and the SpliX driver on the Pi.
- A Google Cloud project, and the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)
  (`gcloud`) on a workstation.
- A Cloudflare account with a zone and a Zero Trust organization, and [OpenTofu](https://opentofu.org)
  on a workstation.

The Google Cloud and Cloudflare resources are declared in `infra/google/` and `infra/cloudflare/`
and applied with OpenTofu from a clone of this repo on your workstation, never from the Pi. Each
directory has its own local, git-ignored state that holds secrets, so keep the workstation clone
safe.

The repo is public: it holds only placeholders (`print.example.com`, `<printer-ip>`,
`<account-id>`, `<zone-id>`). Real values live in git-ignored `.env` and `terraform.tfvars` files.

## Google Cloud setup

The worker authenticates to Drive as a **service account** with the read-only scope, so it can see
only files explicitly shared with it. OpenTofu in `infra/google/` enables the Drive and IAM APIs,
creates the service account (no project roles) and creates its JSON key. The project itself and
the Drive folder sharing are not managed by OpenTofu.

1. On the workstation, sign in and create the project, or reuse an existing one:

   ```sh
   gcloud auth login
   gcloud auth application-default login    # the credentials OpenTofu uses
   gcloud projects create <project-id>      # skip if reusing a project
   ```

2. Apply:

   ```sh
   cd infra/google
   cp terraform.tfvars.example terraform.tfvars   # git-ignored; set project_id
   tofu init
   tofu apply
   tofu output service_account_email               # for step 3
   tofu output -raw service_account_key | base64 -d > service-account.json
   ```

   The key's private part is stored in the local state, so treat `terraform.tfstate` as a password
   file. If key creation is refused with an organization-policy error
   (`iam.disableServiceAccountKeyCreation`, the default for Google Cloud organizations created since
   2024), the project belongs to an organization that blocks keys. A personal account with no
   organization is not affected.

3. In Google Drive, create the **print folder** and share it with the `service_account_email` address
   as **Viewer**. The agent must save its PDFs into this folder. Drive permissions are Drive data, not
   Google Cloud resources, so OpenTofu cannot do this step.
4. Copy `service-account.json` to the Pi and install it **outside the checkout**, readable only by the
   service user (the service user is created in
   [Deploying](#deploying-on-the-raspberry-pi-systemd)). Then delete both copies of the downloaded
   file: the state is now the only source of the key.

   ```sh
   # on the workstation
   scp service-account.json <pi-host>: && rm service-account.json
   # on the Pi
   sudo install -d -o root -g print-me -m 0750 /etc/print-me
   sudo install -o print-me -g print-me -m 0600 ~/service-account.json /etc/print-me/service-account.json
   rm ~/service-account.json
   ```

   `GOOGLE_APPLICATION_CREDENTIALS` in `apps/worker/.env` points at this path. Never commit the key.

To rotate the key, run `tofu apply -replace=google_service_account_key.worker`, repeat step 4 and
`sudo systemctl restart print-me-worker`. The old key is deleted during the apply, so Drive calls
fail, and jobs retry, until the new key is installed.

## Printer setup (CUPS + SpliX)

The SCX-4623FW most likely speaks only Samsung's SPL language, so PDFs are converted by CUPS with
the open-source SpliX driver. The worker just runs `lp`. This setup was proven end to end on the
target Pi (a CUPS test page physically printed).

1. Install the packages. `--no-install-recommends` keeps out `cups-browsed`, which is not needed and
   had a serious vulnerability in 2024. CUPS stays loopback-only.

   ```sh
   sudo apt-get install --no-install-recommends cups cups-client cups-filters printer-driver-splix
   ```

2. **Reserve a DHCP address for the printer** in your router, and use that address below. CUPS
   reports success for a queue pointing at the wrong address (`lp` still returns job IDs and nothing
   prints), so a drifting address fails silently.
3. Set `CUPS_PRINTER_NAME` and `PRINTER_DEVICE_URI` in `apps/worker/.env` (see
   [Environment variables](#environment-variables)), then create the queue from those values. The
   proven device URI scheme is a raw socket on port 9100, and the proven PPD is the model-specific
   `scx4623fw.ppd` (`lpinfo -m` also lists `scx4623f.ppd`; use the `fw` one):

   ```sh
   # in apps/worker: load the values from .env
   set -a && . ./.env && set +a
   sudo lpadmin -p "$CUPS_PRINTER_NAME" -E -v "$PRINTER_DEVICE_URI" -m drv:///splix-samsung.drv/scx4623fw.ppd
   sudo cupsenable "$CUPS_PRINTER_NAME" && sudo cupsaccept "$CUPS_PRINTER_NAME"
   ```

   With the example values this is `lpadmin -p scx4623fw -E -v socket://<printer-ip>:9100 -m
drv:///splix-samsung.drv/scx4623fw.ppd`. `lpadmin` prints `Printer drivers are deprecated and
will stop working in a future version of CUPS`. That is harmless today; see Troubleshooting.

4. Check the queue and the address CUPS will actually use, then print a test page:

   ```sh
   lpstat -p scx4623fw            # printer scx4623fw is idle.  enabled since ...
   lpstat -v scx4623fw            # device for scx4623fw: socket://<printer-ip>:9100
   lp -d scx4623fw /usr/share/cups/data/testprint
   ```

   To change the address of an existing queue: `sudo lpadmin -p scx4623fw -v
socket://<printer-ip>:9100`, then re-check with `lpstat -v`.

5. **Service-user permissions.** The worker runs as the loginless `print-me` user and must be able
   to submit to the queue. This is checked at deployment (see
   [Verification](#verification)): `sudo -u print-me lp -d scx4623fw sample.pdf`. CUPS's default
   policy lets any local user submit jobs, so no group membership is expected. If CUPS refuses,
   check the queue's user allow list (`lpoptions -p scx4623fw | tr ' ' '\n' | grep requesting-user`)
   and allow the service user with `sudo lpadmin -p scx4623fw -u allow:print-me`. Do not add
   `print-me` to the `lpadmin` group: that grants CUPS admin rights the worker doesn't need.

## Setup

### Environment variables

Copy each `.env.example` to `.env` (git-ignored) and fill in real values. Each app loads `.env` from
its own package directory regardless of the working directory; variables already in the process
environment (for example from systemd's `EnvironmentFile=`) win.

**`apps/web/.env`**

| Variable            | Required | Default | Meaning                                                                                                                                                                                |
| ------------------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_PATH`           | yes      | none    | Absolute path to the shared SQLite file; the worker must use the same file (`.env.example`: `/opt/print-me/data/print-me.sqlite`).                                                     |
| `PORT`              | no       | `3100`  | Loopback port to listen on (the host is fixed at `127.0.0.1`). Must match `web_port` in `infra/cloudflare`.                                                                            |
| `MAX_JOBS_PER_HOUR` | no       | `20`    | Most jobs that may be created in any one-hour window; `POST /print` returns 429 beyond it. A repeat request for a file that is already `queued`/`processing` does not count toward it. |

**`apps/worker/.env`**

| Variable                         | Required | Default    | Meaning                                                                                                                |
| -------------------------------- | -------- | ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| `DB_PATH`                        | yes      | none       | Same SQLite file as the web app.                                                                                       |
| `GOOGLE_APPLICATION_CREDENTIALS` | yes      | none       | Path to the service account's JSON key, outside the checkout (`/etc/print-me/service-account.json`).                   |
| `CUPS_PRINTER_NAME`              | yes      | none       | CUPS queue the worker prints to with `lp -d` (`scx4623fw`).                                                            |
| `PRINTER_DEVICE_URI`             | no       | none       | The printer's address, e.g. `socket://<printer-ip>:9100`. **Not read by the worker**: only the `lpadmin` step uses it. |
| `POLL_INTERVAL_MS`               | no       | `10000`    | Milliseconds between ticks; each tick handles at most one job.                                                         |
| `MAX_FILE_BYTES`                 | no       | `52428800` | Largest Drive file accepted (50 MB), checked from Drive metadata before downloading. Larger files fail permanently.    |

Numeric values must be positive integers or the app refuses to start.

### Build and run

```sh
pnpm install
pnpm run build                       # build all packages (shared -> web, worker)
pnpm run check                       # typecheck everything
pnpm run format                      # prettier --write .
pnpm run format:check                # prettier --check .
pnpm --filter @print-me/web dev      # web app with watch/restart (tsx)
pnpm --filter @print-me/worker dev   # worker with watch/restart (tsx)
pnpm --filter @print-me/web start    # run the built web app (needs a build)
```

Unit tests: `pnpm --filter @print-me/shared test` and `pnpm --filter @print-me/worker test`.
For local development, point `DB_PATH` somewhere disposable, such as `/tmp/print-me.sqlite`.

## Deploying on the Raspberry Pi (systemd)

The layout mirrors the other apps on the Pi: a dedicated loginless system user owns the checkout,
the env files and the SQLite database, with the repo at `/opt/print-me`. The units
`apps/web/print-me-web.service`, `apps/worker/print-me-worker.service` and
`infra/cloudflare/print-me-tunnel.service` expect exactly this layout; for a different path or
user, edit `User=` and the absolute paths before installing them.

### 1. Create the service user and install location

```sh
sudo useradd --system --user-group --home-dir /opt/print-me --shell /usr/sbin/nologin print-me
sudo mkdir -p /opt/print-me
sudo chown print-me:print-me /opt/print-me
```

Run commands as it with `sudo -u print-me -H <command>`.

### 2. Check out, build and configure

```sh
sudo -u print-me -H git clone <repo-url> /opt/print-me
cd /opt/print-me
sudo install -d -o print-me -g print-me -m 0750 /opt/print-me/data   # holds the SQLite file
sudo -u print-me -H cp apps/web/.env.example apps/web/.env
sudo -u print-me -H cp apps/worker/.env.example apps/worker/.env
# fill in both .env files (sudoedit -u print-me, or edit as root)
sudo -u print-me -H pnpm install
sudo -u print-me -H pnpm run build   # produces apps/*/dist/index.js
```

Set up the Google key and the CUPS queue first (above), and check the service user can print
(see [Verification](#verification)).

### 3. Install and enable the units

```sh
sudo cp /opt/print-me/apps/web/print-me-web.service /etc/systemd/system/
sudo cp /opt/print-me/apps/worker/print-me-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now print-me-web print-me-worker
```

Logs: `journalctl -u print-me-web -f` (Fastify's JSON log lines) and
`journalctl -u print-me-worker -f`. Both units restart automatically (`Restart=always`). The web
unit is hardened and may only write `/opt/print-me/data`; if you move `DB_PATH`, update its
`ReadWritePaths=`. On the Pi, `curl -s http://127.0.0.1:3100/healthz` returns `{"ok":true}`.

## Publishing the webhook with Cloudflare Tunnel

Everything on the Cloudflare side is provisioned with OpenTofu from `infra/cloudflare/`: a remotely
managed tunnel (ingress to `http://127.0.0.1:<web_port>` plus a catch-all 404), a proxied CNAME, an
Access application, and an Access **service token** with a policy that admits only that token. No
identity provider and no email allow-list: only the agent holding the token gets through. This
project has its own tunnel, DNS record, Access app and OpenTofu state, separate from screen-time's;
the two share only the Cloudflare account and zone.

### 1. Prerequisites

- The domain added as a Cloudflare zone, and a Zero Trust organization (Free plan is fine).
- Your account ID and zone ID (dashboard overview page).
- A Cloudflare API token, as a custom token with: Account → Cloudflare Tunnel → Edit; Account →
  Access: Apps and Policies → Edit; Account → Access: Service Tokens → Edit; Zone → DNS (scoped to
  the one zone) → Edit. Export it in your shell; it is never written to a file:

  ```sh
  export CLOUDFLARE_API_TOKEN=...
  ```

- A **single-label hostname** under the zone (`print.example.com`). Universal SSL covers `<zone>`
  and `*.<zone>` only, so a deeper name fails TLS with no obvious cause.

### 2. Provision

```sh
cd infra/cloudflare
cp terraform.tfvars.example terraform.tfvars   # git-ignored; fill in account_id, zone_id, hostname
tofu init
tofu apply
tofu output service_token_expires_at           # set a calendar reminder ahead of this date
```

`web_port` defaults to `3100` and must match the web app's `PORT`. State is local, plaintext and
git-ignored: it holds the tunnel token and the service-token secret, so treat it as a password
file. The three secret outputs (`tunnel_token`, `service_token_client_id`,
`service_token_client_secret`) are marked sensitive; read each deliberately with
`tofu output -raw <name>`.

### 3. Install the tunnel connector on the Pi

This runs next to screen-time's connector without clashing: its own tunnel, its own token file
(`/etc/cloudflared/print-me.token`, not `/etc/cloudflared/token`) and its own metrics port
(`127.0.0.1:20242`, not `20241`). The `cloudflared` user, binary and `/etc/cloudflared` directory
are shared, so skip those steps if screen-time's tunnel is installed. Otherwise install
`cloudflared` from [Cloudflare's apt repository](https://pkg.cloudflare.com/) first.

```sh
sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin cloudflared   # skip if it exists
sudo install -d -o root -g cloudflared -m 0750 /etc/cloudflared                             # skip if it exists
sudo install -o root -g cloudflared -m 0640 /dev/null /etc/cloudflared/print-me.token
sudoedit /etc/cloudflared/print-me.token     # paste `tofu output -raw tunnel_token`, nothing else
sudo cp /opt/print-me/infra/cloudflare/print-me-tunnel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now print-me-tunnel
curl -s http://127.0.0.1:20242/ready         # {"status":200,"readyConnections":4,...}
```

Logs: `journalctl -u print-me-tunnel -f`. Three benign startup lines are not worth fixing (ICMP proxy
disabled, the ping_group_range warning, and no default origin certificate path). Update
`cloudflared` periodically with
`sudo apt-get update && sudo apt-get install --only-upgrade -y cloudflared && sudo systemctl restart print-me-tunnel`
(the same package serves screen-time's tunnel, so restart that unit too).

## Webhook API reference

Base URL: `https://print.example.com`. Every route sits behind Cloudflare Access and needs both
headers; a request without valid headers is rejected at the edge with a plain **401** and never
reaches the app:

```
CF-Access-Client-Id: <client id>
CF-Access-Client-Secret: <client secret>
```

| Route            | Request                                           | Responses                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /print`    | JSON body `{ "url": "<Google Drive file link>" }` | `202 { id }` new job queued; `200 { id }` a job for the same Drive file is already `queued`/`processing`; `400` missing body or not a recognised Drive link; `429` hourly cap reached (see below) |
| `GET /print/:id` | none                                              | `200 { id, state, attempts, lastError, cupsJobId, createdAt, updatedAt }`; `400` if `:id` is not a positive integer; `404` unknown id                                                             |
| `GET /healthz`   | none                                              | `200 { ok: true }`                                                                                                                                                                                |

- **Accepted links**: `https://drive.google.com/file/d/<id>/...`, `.../open?id=<id>` and
  `.../uc?id=<id>`. The document type comes from the Drive file's mimeType when it is processed;
  only `application/pdf` prints.
- **Dedupe**: posting a link for a file whose job is still `queued` or `processing` returns `200`
  with that job's `id` instead of creating another, so a retried request is safe. Once the job is
  `printed` or `failed`, posting the same file creates a new job, so reprinting works. There is no
  `Idempotency-Key` header.
- **Hourly cap**: once `MAX_JOBS_PER_HOUR` jobs have been created in the last hour, `POST /print`
  returns `429` with a `Retry-After: <seconds>` header and a body
  `{ "error": "...", "retryAfterSeconds": <seconds> }` (the same value: the seconds until the oldest
  job in the window ages out, rounded up, minimum 1). A deduplicated request never counts.
- **States**: `queued`, `processing`, `printed` (accepted by CUPS) or `failed`. A job that keeps
  failing reaches `failed` about 15 minutes after it was queued; `attempts` and `lastError` show
  progress from the first failure. Poll `GET /print/:id`.
- **`/healthz`** runs a trivial SQLite query. Because it is behind Access too, it separates an
  Access rejection (401) from a down app (502) and a down tunnel (Cloudflare error 1033).

```sh
# Queue a print (202 { "id": 42 }; 200 with the same id if already queued/processing)
curl -sS -X POST https://print.example.com/print \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://drive.google.com/file/d/<file-id>/view"}'

# Check on it
curl -sS https://print.example.com/print/42 \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET"
# {"id":42,"state":"printed","attempts":1,"lastError":null,"cupsJobId":"scx4623fw-3",
#  "createdAt":"...","updatedAt":"..."}

# Health
curl -sS https://print.example.com/healthz \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET"
```

## Handing the integration to the agent

The agent needs three things:

1. The public hostname (`tofu output app_url`).
2. The service-token client ID and secret (`tofu output -raw service_token_client_id` and
   `-raw service_token_client_secret`). Hand them over through a **vault link**, never in chat, and
   never in the repo.
3. Which Drive folder is the print folder: the one shared with the service account. PDFs saved
   anywhere else are invisible to the worker and fail after 5 attempts.

It then saves a PDF into that folder and calls `POST /print` with the file's link, and polls
`GET /print/:id` if it wants the outcome.

## Verification

On the Pi:

```sh
lpstat -p scx4623fw                                  # queue enabled
lpstat -v scx4623fw                                  # device URI is the reserved printer address
sudo -u print-me lp -d scx4623fw sample.pdf          # the service user can print
sudo -u print-me lp -d scx4623fw -- sample.pdf       # ...and the worker's `--` form works too
systemctl status print-me-web print-me-worker print-me-tunnel
curl -s http://127.0.0.1:3100/healthz                # {"ok":true}
curl -s http://127.0.0.1:20242/ready                 # readyConnections > 0
sqlite3 /opt/print-me/data/print-me.sqlite '.indexes print_job'   # lists idx_print_job_active_drive_file
```

From outside the LAN:

```sh
# Without headers: rejected by Access with 401
curl -i -X POST https://print.example.com/print -H "Content-Type: application/json" -d '{}'

# With headers and a real Drive PDF link: 202, then poll until "printed"
curl -sS -X POST https://print.example.com/print \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://drive.google.com/file/d/<file-id>/view"}'
```

The job should reach `printed` with a `cupsJobId` within a poll interval, and the page should come
out of the printer. `GET /healthz` with headers is 200 and without them is 401.

## Troubleshooting

| Symptom                                                             | Cause and fix                                                                                                                                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **401** from the public hostname                                    | Missing or wrong `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers, or the service token expired (see rotation).                                                                         |
| Cloudflare **error 1033**                                           | The connector is down: `systemctl status print-me-tunnel`.                                                                                                                                       |
| **502**                                                             | Tunnel is up, the app is not: `systemctl status print-me-web`. Also check `PORT` equals `web_port`.                                                                                              |
| `429` on `POST /print`                                              | Hourly cap reached; wait `Retry-After` seconds or raise `MAX_JOBS_PER_HOUR`.                                                                                                                     |
| Job `failed` with a Drive 404 or permission error in `lastError`    | The file is not in the folder shared with the service account (Viewer), or its sharing has not propagated yet. The 5-attempt backoff covers brief delays.                                        |
| Job `failed`: unsupported document type                             | Only PDFs print. The agent must save a real PDF, not a Google Doc.                                                                                                                               |
| Job `failed`: over `MAX_FILE_BYTES`                                 | The file is bigger than the cap; raise `MAX_FILE_BYTES` in `apps/worker/.env` and restart the worker.                                                                                            |
| Job `printed` but nothing comes out                                 | CUPS accepted it but the printer did not. Check `lpstat -o scx4623fw` and `lpstat -v scx4623fw`: a wrong or drifted device address still "succeeds". Fix the address and use a DHCP reservation. |
| Stuck jobs in the CUPS queue                                        | `lpstat -o scx4623fw`, then `cancel -a scx4623fw` (add `sudo` if it says "not authorized").                                                                                                      |
| `lp` refused for the service user                                   | See the service-user permissions note in Printer setup (`lpadmin` group).                                                                                                                        |
| `lpadmin`: "Printer drivers are deprecated..."                      | Harmless today. A future CUPS upgrade may stop `drv:///` driver PPDs from working; if printing breaks after an upgrade, re-check the queue and driver first.                                     |
| Web or worker exits at start with "Refusing to start: unique index" | The partial unique index could not be created in `DB_PATH`; check the file's permissions and that both apps use the same, writable path.                                                         |
| Repeated `Failed to create new quic connection` in the tunnel log   | The router blocks outbound UDP/7844: add `--protocol http2` to the tunnel unit's `ExecStart`, never a port forward.                                                                              |

### Rotating the Access service token

The token lasts one year (8760h). `tofu output service_token_expires_at` shows when; set a reminder
ahead of it. After expiry the agent's requests get 401.

```sh
cd infra/cloudflare
tofu apply -replace=cloudflare_zero_trust_access_service_token.agent
tofu output -raw service_token_client_id
tofu output -raw service_token_client_secret
```

The token resource uses `create_before_destroy`, so the new token is created and the policy
repointed before the old one is deleted. Then **re-vault** the new ID and secret, update the agent
to use them, and confirm with the verification requests above. The old credentials stop working
once the apply finishes.

### Rolling back

```sh
# On the Pi: stop the connector, let connections drain
sudo systemctl disable --now print-me-tunnel && sleep 15

# On the workstation: tear down the Cloudflare side, then the Google service account and key
tofu -chdir=infra/cloudflare destroy
tofu -chdir=infra/google destroy
```

`tofu destroy` does not remove the Google Cloud project, the enabled APIs, the Drive folder sharing,
the Zero Trust organization, or the local state files.
