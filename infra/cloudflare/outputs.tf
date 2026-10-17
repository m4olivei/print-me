output "app_url" {
  description = "Public base URL of the webhook."
  value       = local.app_url
}

output "tunnel_id" {
  description = "UUID of the tunnel; matches the connector shown in Zero Trust > Networks > Tunnels."
  value       = cloudflare_zero_trust_tunnel_cloudflared.print_me.id
}

# The three secrets below are marked sensitive so they are never printed by a
# plain `tofu output` or an apply summary. Read each one deliberately with
# `tofu output -raw <name>`.

# Paste into /etc/cloudflared/print-me.token on the Pi.
output "tunnel_token" {
  description = "Connector token for print-me-tunnel.service on the Pi."
  value       = data.cloudflare_zero_trust_tunnel_cloudflared_token.print_me.token
  sensitive   = true
}

# The agent sends these as the CF-Access-Client-Id and CF-Access-Client-Secret
# headers. Hand them over through a vault link, never in chat. Cloudflare shows
# the secret only once, at creation, so the state file is its only copy here.
output "service_token_client_id" {
  description = "Access service token client ID (CF-Access-Client-Id header)."
  value       = cloudflare_zero_trust_access_service_token.agent.client_id
  sensitive   = true
}

output "service_token_client_secret" {
  description = "Access service token client secret (CF-Access-Client-Secret header)."
  value       = cloudflare_zero_trust_access_service_token.agent.client_secret
  sensitive   = true
}

output "service_token_expires_at" {
  description = "When the Access service token expires; set a rotation reminder ahead of it."
  value       = cloudflare_zero_trust_access_service_token.agent.expires_at
}
