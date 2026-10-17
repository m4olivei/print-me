# Anything holding a real account value is declared without a default, so the
# committed files stay free of personal data: fill terraform.tfvars (git-ignored)
# from terraform.tfvars.example.

variable "account_id" {
  description = "Cloudflare account ID (dashboard overview page)."
  type        = string
}

variable "zone_id" {
  description = "Zone ID of the domain the webhook is published under."
  type        = string
}

variable "hostname" {
  description = <<-EOT
    Public hostname of the webhook, e.g. print.example.com: a bare lowercase
    DNS name, with no scheme, path or trailing dot. Keep it a single label
    under the zone: Cloudflare's Universal SSL covers <zone> and *.<zone> only,
    so a deeper name like print.home.<zone> fails TLS with no obvious cause.
  EOT
  type        = string

  validation {
    condition     = can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", var.hostname)) && length(split(".", var.hostname)) >= 3
    error_message = "hostname must be a bare lowercase name under the zone, like print.example.com (no scheme, path, port or trailing dot)."
  }
}

variable "web_port" {
  description = <<-EOT
    Loopback port the web app listens on (PORT in apps/web/.env). The tunnel
    forwards to http://127.0.0.1:<web_port>, so this must match the web app;
    3100 is the web app's default, chosen to stay clear of screen-time's 3000
    on the same Pi. 127.0.0.1 rather than localhost: with the app bound to IPv4
    loopback, localhost resolving to ::1 first yields a confusing 502.
  EOT
  type        = number
  default     = 3100

  validation {
    condition     = var.web_port == floor(var.web_port) && var.web_port >= 1 && var.web_port <= 65535
    error_message = "web_port must be an integer from 1 to 65535."
  }
}

locals {
  origin_service = "http://127.0.0.1:${var.web_port}"
  app_url        = "https://${var.hostname}"
}
