output "service_account_email" {
  description = "Share the Drive print folder with this address, as Viewer."
  value       = google_service_account.worker.email
}

# Sensitive so it is never printed by a plain `tofu output` or an apply
# summary. Write it straight to a file instead:
#   tofu output -raw service_account_key | base64 -d > service-account.json
output "service_account_key" {
  description = "Base64-encoded JSON key for the worker (GOOGLE_APPLICATION_CREDENTIALS)."
  value       = google_service_account_key.worker.private_key
  sensitive   = true
}
