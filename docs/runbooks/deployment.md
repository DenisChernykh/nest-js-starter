# Stage promotion by immutable digest

This runbook promotes one already-published Stage image. It is an operational
procedure, not evidence that Dokploy or any production environment has been
called. Keep the change window exclusive: a second deploy makes it unsafe to
identify the newly created deployment record.

## Fixed candidate and preflight

The approved candidate is supplied through <code>CANDIDATE_IMAGE_REF</code> and
must match the approved immutable GHCR reference byte-for-byte:
<code>ghcr.io/denischernykh/nest-js-starter@sha256:84d0fdb162020eea35113c9b05071f61179e01a6f47a7ea088b69cead393d112</code>.
This reference carries revision
<code>ddfacb316ecb721e4e0a7d2967816b8bbfd875f0</code>. Never substitute a tag,
including a commit-SHA tag, for this digest. The API runtime must receive
<code>RUNTIME_DATABASE_URL</code> as its <code>DATABASE_URL</code>; keep it
separate from the migration-only <code>MIGRATION_DATABASE_URL</code> and do not
print either connection URL.

Before a change window:

1. Confirm that the Stage workflow for revision
   <code>ddfacb316ecb721e4e0a7d2967816b8bbfd875f0</code> succeeded, published the
   exact <code>CANDIDATE_IMAGE_REF</code>, and recorded a passing OCI smoke and
   vulnerability gate.
2. Pull and inspect that immutable reference from a controlled operator host.
   Require <code>org.opencontainers.image.revision</code> to equal the exact
   revision. Also record the image digest and the OCI source label as incident
   evidence.
3. Confirm that the API runtime identity is least-privilege and cannot run
   Prisma migrations. Keep migration credentials separate from API runtime
   credentials.
4. Check that the candidate is compatible with the currently applied schema.
   If a rollback may be needed, also establish that the previous API image is
   compatible with the schema after this promotion.

```sh
set -eu

test -n "$CANDIDATE_IMAGE_REF" || {
  echo 'CANDIDATE_IMAGE_REF is required' >&2
  exit 1
}
test -n "$MIGRATION_DATABASE_URL" || {
  echo 'MIGRATION_DATABASE_URL is required' >&2
  exit 1
}
test -n "$RUNTIME_DATABASE_URL" || {
  echo 'RUNTIME_DATABASE_URL is required' >&2
  exit 1
}
test -n "$PUBLIC_API_URL" || {
  echo 'PUBLIC_API_URL is required' >&2
  exit 1
}
approved_candidate_image_ref='ghcr.io/denischernykh/nest-js-starter@sha256:84d0fdb162020eea35113c9b05071f61179e01a6f47a7ea088b69cead393d112'
candidate_revision='ddfacb316ecb721e4e0a7d2967816b8bbfd875f0'
test "$CANDIDATE_IMAGE_REF" = "$approved_candidate_image_ref" || {
  echo 'CANDIDATE_IMAGE_REF is not the approved immutable candidate' >&2
  exit 1
}

docker pull "$CANDIDATE_IMAGE_REF"
docker image inspect "$CANDIDATE_IMAGE_REF" \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
  | grep -Fx "$candidate_revision"
```

If the Stage run, digest, revision label, OCI checks, runtime-role separation,
or compatibility review cannot be proven, stop. Do not configure a provider or
start an API deployment.

## Order of change

1. Freeze concurrent deployments and capture the previous API digest as the
   rollback candidate.
2. Verify <code>CANDIDATE_IMAGE_REF</code> and its revision label as shown above.
3. Run the one-shot migrator with <code>MIGRATION_DATABASE_URL</code>.
4. Only after the migrator exits successfully, configure the candidate digest
   in the deployment adapter.
5. Mutate the API deployment and wait for one identified deployment to reach
   its terminal state.
6. Run the external smoke checks below.

The repository's Prisma config reads <code>DATABASE_URL</code>. Run the
migrator from the exact image that was pulled and label-verified above, so the
migration files and application revision cannot come from an unrelated
checkout. The operator maps the canonical migration input only inside this
one-shot container:

```sh
(
  # Pass only the exported variable name to Docker. The value is not placed in
  # the docker command's argv or in a process-listing argument.
  export DATABASE_URL="$MIGRATION_DATABASE_URL"
  docker run --rm \
    --env DATABASE_URL \
    --entrypoint corepack \
    "$CANDIDATE_IMAGE_REF" \
    pnpm@11.15.1 start:migrate
)
```

Attach the operator's isolated migration network to this command when the
database is not reachable from the Docker default network. The image itself is
the only source of <code>prisma.config.ts</code>, migration files and the
<code>start:migrate</code> script; never substitute a host checkout or a
mutable image tag.

The API image must not be changed after any migrator failure. Preserve the
failed migrator logs and diagnose the database or migration; do not retry by
starting the API or by attempting an automatic down-migration. Configure the
long-running API with <code>DATABASE_URL</code> resolved from
<code>RUNTIME_DATABASE_URL</code> only after this command succeeds.

<code>docs/runbooks/dokploy-deployment.md</code> supplies the Dokploy adapter
calls and bounded polling. <code>docs/runbooks/rollback.md</code> supplies the
response to a failed deployment or smoke check.

## External smoke after a successful deployment

Use <code>PUBLIC_API_URL</code> as the public Stage base URL. It is intentionally
read from the environment so that no environment URL is committed or printed.
All three health endpoints must return <code>200</code>;
<code>/v1/auth/me</code> without a cookie must return the RFC 9457
authentication problem, not a redirect or HTML page.

```sh
set -eu

public_api_url="$(printf '%s' "$PUBLIC_API_URL" | sed 's:/$::')"

check_health() {
  local status
  status="$(curl --silent --show-error --output /dev/null \
    --write-out '%{http_code}' "$public_api_url$1")"
  test "$status" = '200'
}

check_health /health/live
check_health /health/startup
check_health /health/ready

auth_body="$(mktemp)"
auth_headers="$(mktemp)"
trap 'rm -f -- "$auth_body" "$auth_headers"' EXIT
auth_status="$(curl --silent --show-error --output "$auth_body" \
  --dump-header "$auth_headers" --write-out '%{http_code}' \
  "$public_api_url/v1/auth/me")"
test "$auth_status" = '401'
grep -qi '^content-type: application/problem+json' "$auth_headers"
jq -e '.code == "AUTHENTICATION_REQUIRED" and .status == 401' "$auth_body" >/dev/null
```

Any HTTP transport/API error, a non-<code>done</code> deployment status, polling
timeout, or failed smoke is a failed promotion. Do not treat
<code>running</code>, a missing status, or an unknown status as success. Keep
the response/log evidence free of cookies, credentials, connection URLs and
user data, then enter the rollback or roll-forward decision in
<code>docs/runbooks/rollback.md</code>.
