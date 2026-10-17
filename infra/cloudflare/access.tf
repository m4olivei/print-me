# Cloudflare Access: the authentication layer. Every request to the hostname is
# checked at the edge and only forwarded down the tunnel when it carries this
# service token's CF-Access-Client-Id and CF-Access-Client-Secret headers. The
# web app itself has no auth code. There is no identity provider and no email
# allow-list: no person can sign in, only the agent holding the token.

# The agent's credential. 8760h (one year) is Cloudflare's default, set
# explicitly so the expiry is a visible decision; the service_token_expires_at
# output gives the date for a rotation reminder. Rotate with
#   tofu apply -replace=cloudflare_zero_trust_access_service_token.agent
# which issues a new client ID and secret. create_before_destroy makes that
# create the new token and repoint the policy before the old token is deleted,
# so the policy never references a token that no longer exists.
resource "cloudflare_zero_trust_access_service_token" "agent" {
  account_id = var.account_id
  name       = "print-me agent"
  duration   = "8760h"

  lifecycle {
    create_before_destroy = true
  }
}

# A reusable, account-level policy. "non_identity" is Cloudflare's Service Auth
# decision: it matches on the service token alone and never sends the request
# to a login page. The token is the only include rule, so nothing else passes.
resource "cloudflare_zero_trust_access_policy" "agent" {
  account_id = var.account_id
  name       = "print-me agent service token"
  decision   = "non_identity"

  include = [
    {
      service_token = {
        token_id = cloudflare_zero_trust_access_service_token.agent.id
      }
    },
  ]
}

resource "cloudflare_zero_trust_access_application" "print_me" {
  account_id = var.account_id
  name       = "print-me"
  type       = "self_hosted"
  domain     = var.hostname

  policies = [
    {
      id         = cloudflare_zero_trust_access_policy.agent.id
      precedence = 1
    },
  ]

  # A request without valid service-token headers gets a plain 401 instead of
  # a 302 to the Access login page, which an HTTP client could follow and
  # mistake for a 200. That keeps "Access rejected me" distinct from a down app
  # (502) or a down tunnel (1033) for the agent.
  service_auth_401_redirect = true

  # Machine-to-machine only: nothing for a person to launch.
  app_launcher_visible = false
}
