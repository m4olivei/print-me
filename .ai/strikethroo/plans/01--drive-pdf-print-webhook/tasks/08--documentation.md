---
id: 8
group: "docs"
dependencies: [1, 5, 6, 7]
status: "completed"
created: 2026-10-17
skills:
  - technical-writing
  - markdown
complexity_score: 4
execution_profile: "docs-and-config"
---
# Documentation: README, AGENTS.md, CLAUDE.md

## Objective
Write the human setup/operations README, the AI-facing AGENTS.md and a CLAUDE.md pointer, as specified in the plan's Documentation section, matching what tasks 1–7 actually built.

## Skills Required
technical-writing, markdown.

## Acceptance Criteria
- [x] `README.md` covers every bullet of the plan's Documentation → README section: architecture overview; requirements; Google Cloud setup (project, Drive API, service account + JSON key, share folder as Viewer, key location on the Pi outside the checkout); CUPS + SpliX setup from `.env` values (the `apt-get install --no-install-recommends cups cups-client cups-filters printer-driver-splix` line, DHCP reservation, `lpadmin` with the URI scheme proven in `spike-results.md`, test print, any service-user CUPS permission note); env variable tables per app; build/run commands; systemd deployment under `/opt/print-me` with a service user; Cloudflare prerequisites, `tofu apply`, installing the tunnel unit next to screen-time's; Webhook API reference matching the plan's Data Contract (headers, dedupe, cap/429 with `Retry-After`, ~15-minute worst case, `printed` = accepted by CUPS); handing the integration to the agent (hostname, vault link, print folder); verification, troubleshooting and service-token rotation (`tofu apply -replace`, expiry output, re-vaulting).
- [x] `AGENTS.md` covers layout, binding invariants (web touches only SQLite; worker sole caller of Drive and CUPS; SQLite only shared state; edge-only auth so web binds 127.0.0.1; single authorities in shared for retry policy, job intake and handler registry; `lp` called only through one helper), the duplicate-print trade-off, locked tech decisions, things not to add (from the plan's out-of-scope list), and commands.
- [x] `CLAUDE.md` points at `AGENTS.md` (as in screen-time).
- [x] Env var names, defaults, ports, paths and unit names in the docs match the code and `.env.example` files exactly (verify with `grep`).
- [x] No personal data: placeholders only (`print.example.com`, `<printer-ip>`, `<account-id>`). Verification: `git grep -nE '192\.168\.|\b10\.[0-9]+\.[0-9]+\.[0-9]+|@gmail\.com|BEGIN PRIVATE KEY|"private_key"'` returns only documented placeholders or nothing; `pnpm run format:check` exits 0.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
Markdown formatted by Prettier.

## Input Dependencies
Tasks 1 (spike results), 5, 6, 7 (actual env vars, units, outputs).

## Output Artifacts
`README.md`, `AGENTS.md`, `CLAUDE.md`.

## Implementation Notes
<details>
<summary>Guidance</summary>

- Read screen-time's `README.md`, `AGENTS.md` and `CLAUDE.md` (`gh repo clone m4olivei/screen-time <scratchpad>/screen-time`) and follow their structure and tone.
- Read the final code (`apps/*/src`, `apps/*/.env.example`, unit files, `infra/cloudflare/*.tf`) before writing, so names match; do not invent variables.
- Copy the Data Contract table from the plan's Notes section into the README's API reference and expand with curl examples using placeholder hostnames and `$CF_ACCESS_CLIENT_ID`/`$CF_ACCESS_CLIENT_SECRET` env vars.
- No tests: documentation.
</details>
