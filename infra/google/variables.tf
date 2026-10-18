# The project ID is declared without a default, so the committed files stay
# free of personal data: fill terraform.tfvars (git-ignored) from
# terraform.tfvars.example.

variable "project_id" {
  description = <<-EOT
    ID of an existing Google Cloud project to hold the worker's service account,
    e.g. created with `gcloud projects create <project-id>`. The project itself
    is not managed here, so `tofu destroy` never deletes it.
  EOT
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a Google Cloud project ID: 6-30 lowercase letters, digits or hyphens, starting with a letter."
  }
}
