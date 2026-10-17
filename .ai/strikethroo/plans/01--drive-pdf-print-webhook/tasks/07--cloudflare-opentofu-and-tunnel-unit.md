---
id: 7
group: "infra"
dependencies: [2]
status: "pending"
created: 2026-10-17
skills:
  - opentofu
  - cloudflare
complexity_score: 5
execution_profile: "standard-implementation"
---
# Cloudflare Tunnel and Access in OpenTofu, plus Tunnel systemd Unit

## Objective
Declare the Cloudflare Tunnel, DNS record, Access application, service token and service-auth-only policy in `infra/cloudflare/` (Cloudflare provider v5), and add the hardened `print-me-tunnel.service` unit.

## Skills Required
opentofu, cloudflare.

## Acceptance Criteria
- [ ] Files: `versions.tf` (OpenTofu + `cloudflare/cloudflare` `~> 5.x`), `variables.tf` (`account_id`, `zone_id`, `hostname`, `web_port` with description; no defaults containing personal data), `tunnel.tf`, `access.tf`, `outputs.tf`, `terraform.tfvars.example` (placeholders like `print.example.com`, `<account-id>`), committed `.terraform.lock.hcl`.
- [ ] Resources: remotely managed tunnel (`config_src = "cloudflare"`) with ingress `hostname → http://127.0.0.1:<web_port>` plus catch-all `http_status:404`; proxied CNAME to `<tunnel_id>.cfargotunnel.com`; Access self-hosted application for the hostname; Access service token with duration `8760h`; Access policy with decision `non_identity` that includes only that service token, attached to the application.
- [ ] Outputs: tunnel token, service token client ID and client secret (all `sensitive = true`), service token expiry (not sensitive).
- [ ] API token is read from `CLOUDFLARE_API_TOKEN` only (provider block has no token argument).
- [ ] `print-me-tunnel.service` copies screen-time's hardened tunnel unit with `--token-file /etc/cloudflared/print-me.token` (distinct from screen-time's) and a distinct `--metrics 127.0.0.1:<port>`.
- [ ] Verification: in `infra/cloudflare`, `tofu init -backend=false`, `tofu validate` and `tofu fmt -check` all exit 0.

Use your internal Todo tool to track these and keep on track.

## Technical Requirements
- OpenTofu is not installed on the dev VM: install it (e.g. the official standalone release binary for linux_arm64 into the scratchpad or `~/.local/bin`) to run validation; do not commit binaries.
- `.terraform/` and state are git-ignored by task 2.

## Input Dependencies
Task 2 (`.gitignore` covering tfstate/tfvars/.terraform).

## Output Artifacts
`infra/cloudflare/*`, tunnel unit; referenced by docs (task 8). Web port default must match task 5's default (`3100` unless task 5 chooses otherwise — use a variable with no default or document the match).

## Implementation Notes
<details>
<summary>Guidance</summary>

- Clone the reference: `gh repo clone m4olivei/screen-time <scratchpad>/screen-time` and copy `infra/cloudflare/` structure and resource shapes (v5 resource names: `cloudflare_zero_trust_tunnel_cloudflared`, `cloudflare_zero_trust_tunnel_cloudflared_config`, `data "cloudflare_zero_trust_tunnel_cloudflared_token"`, `cloudflare_dns_record`, `cloudflare_zero_trust_access_application`, `cloudflare_zero_trust_access_policy`, `cloudflare_zero_trust_access_service_token`). Drop screen-time's Google IdP and email allow-list.
- The policy must use `decision = "non_identity"` with `include = [{ service_token = { token_id = … } }]`.
- Keep the same tunnel unit location convention screen-time uses (e.g. `deploy/systemd/` or `infra/systemd/`); align with where tasks 5 and 6 place their units (check the repo when you start; if tasks 5/6 have not run yet, use screen-time's location).
- Generate the lock file for the platforms the user needs: `tofu providers lock -platform=linux_arm64 -platform=linux_amd64 -platform=darwin_arm64`.
- No tests: declarative configuration.
</details>
