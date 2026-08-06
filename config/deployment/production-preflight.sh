#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf '%s\n' "production preflight failed: $1" >&2
  exit 64
}

require_environment() {
  local name="$1"
  if [[ -z "${!name-}" ]]; then
    fail "$name is required"
  fi
}

validate_unpadded_base64url() {
  local name="$1"
  local value="${!name-}"
  require_environment "$name"
  if [[ ! "$value" =~ ^[A-Za-z0-9_-]+$ ]]; then
    fail "$name must be unpadded base64url"
  fi
  if (( ${#value} < 22 || ${#value} % 4 == 1 )); then
    fail "$name must be unpadded base64url"
  fi
}

require_environment APP_IMAGE
require_environment SERVICE_REVISION

if [[ ! "$APP_IMAGE" =~ ^ghcr[.]io/[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$ ]]; then
  fail 'APP_IMAGE must be a lowercase GHCR image with an exact sha256 digest'
fi
if [[ ! "$SERVICE_REVISION" =~ ^[0-9a-f]{40}$ ]]; then
  fail 'SERVICE_REVISION must be exactly 40 lowercase hexadecimal characters'
fi

for secret_name in \
  POSTGRES_ADMIN_PASSWORD \
  POSTGRES_MIGRATOR_PASSWORD \
  POSTGRES_RUNTIME_PASSWORD \
  REDIS_PASSWORD; do
  validate_unpadded_base64url "$secret_name"
done

for auth_secret_name in \
  AUTH_SESSION_KEY_SECRET \
  AUTH_CSRF_SECRET \
  AUTH_RATE_LIMIT_KEY_SECRET \
  AUTH_NETWORK_METADATA_SECRET; do
  validate_unpadded_base64url "$auth_secret_name"
  auth_value="${!auth_secret_name}"
  if (( ${#auth_value} != 43 )); then
    fail "$auth_secret_name must encode exactly 32 random bytes"
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  fail 'docker is required'
fi

oci_revision="$(
  docker image inspect "$APP_IMAGE" \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
    2>/dev/null
)" || fail 'APP_IMAGE could not be inspected'
if [[ -z "$oci_revision" ]]; then
  fail 'APP_IMAGE is missing the OCI revision label'
fi
if [[ "$oci_revision" != "$SERVICE_REVISION" ]]; then
  fail 'OCI revision label does not match SERVICE_REVISION'
fi

repo_digests="$(
  docker image inspect "$APP_IMAGE" \
    --format '{{ range .RepoDigests }}{{ println . }}{{ end }}' \
    2>/dev/null
)" || fail 'APP_IMAGE RepoDigests could not be inspected'
if ! grep -Fqx -- "$APP_IMAGE" <<<"$repo_digests"; then
  fail 'pulled RepoDigest does not match APP_IMAGE'
fi

printf '%s\n' 'production preflight passed'
