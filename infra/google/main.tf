# The worker's identity in Google Drive: a service account with no project
# roles. It can read only what is explicitly shared with it in Drive (the print
# folder), using the read-only Drive scope requested by the worker.
#
# Sharing the print folder with the service account is NOT managed here: Drive
# permissions are Drive data, not Google Cloud resources, and the provider has
# no resource for them. Share the folder in the Drive UI with the
# service_account_email output, as Viewer.

# drive: what the worker calls. iam: needed to create the service account and
# its key. disable_on_destroy = false so a destroy never switches off an API
# something else in the project may use.
resource "google_project_service" "apis" {
  for_each = toset(["drive.googleapis.com", "iam.googleapis.com"])

  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "worker" {
  account_id   = "print-me-worker"
  display_name = "print-me worker"
  description  = "Reads PDFs from the shared print folder for the print-me worker."

  depends_on = [google_project_service.apis]
}

# The worker's JSON key (GOOGLE_APPLICATION_CREDENTIALS on the Pi). Its private
# key lives in the local state, so treat terraform.tfstate as a password file,
# as with infra/cloudflare. Rotate with
#   tofu apply -replace=google_service_account_key.worker
# then install the new key on the Pi and restart print-me-worker. The apply
# deletes the old key right after creating the new one, so the worker's Drive
# calls fail (and jobs retry) until the new key is in place.
resource "google_service_account_key" "worker" {
  service_account_id = google_service_account.worker.name

  lifecycle {
    create_before_destroy = true
  }
}
