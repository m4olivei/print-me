# Provider and version pins. The major version is pinned because the Google
# provider makes breaking schema changes between majors.

terraform {
  required_version = ">= 1.8"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.7"
    }
  }
}

# Credentials come from Application Default Credentials on the workstation:
#   gcloud auth application-default login
# so no key file is needed to run OpenTofu. With user credentials, the Service
# Usage API needs a quota project; billing_project + user_project_override make
# the target project serve as its own quota project instead of a separate
# `gcloud auth application-default set-quota-project` step.
provider "google" {
  project               = var.project_id
  billing_project       = var.project_id
  user_project_override = true
}
