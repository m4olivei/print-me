# The Cloudflare Tunnel that publishes the webhook. The connector dials out to
# Cloudflare's edge, so nothing is forwarded on the router and the Pi keeps no
# inbound ports open to the internet. It is a separate tunnel from
# screen-time's, run by its own connector (print-me-tunnel.service).

resource "random_bytes" "tunnel_secret" {
  length = 32
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "print_me" {
  account_id = var.account_id
  name       = "print-me"

  # "cloudflare" = remotely managed: the ingress rules below are the source of
  # truth and the Pi needs no /etc/cloudflared/config.yml.
  config_src = "cloudflare"

  tunnel_secret = random_bytes.tunnel_secret.base64
}

# The connector authenticates with this token; it is written to
# /etc/cloudflared/print-me.token on the Pi by hand. See the tunnel_token output.
data "cloudflare_zero_trust_tunnel_cloudflared_token" "print_me" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.print_me.id
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "print_me" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.print_me.id

  config = {
    ingress = [
      {
        hostname = var.hostname
        service  = local.origin_service
      },
      # A catch-all with no hostname is required as the final rule; anything that
      # reaches the connector without matching above is refused rather than
      # forwarded somewhere unintended.
      {
        service = "http_status:404"
      },
    ]
  }
}

# Proxied, so Cloudflare terminates TLS and enforces Access in front of the
# tunnel. The record is flattened at the edge: `dig` shows anycast addresses,
# never the cfargotunnel.com target.
resource "cloudflare_dns_record" "print_me" {
  zone_id = var.zone_id
  name    = var.hostname
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.print_me.id}.cfargotunnel.com"
  proxied = true
  ttl     = 1 # 1 = automatic, and the only value accepted for a proxied record.
  comment = "Cloudflare Tunnel to the print-me webhook (managed by OpenTofu)"
}
