# Stage promotion by immutable digest

This runbook promotes one already-published Stage image. It is an operational
procedure, not evidence that Dokploy or any production environment has been
called. Keep the change window exclusive: a second deploy makes it unsafe to
identify the newly created deployment record.

## Fixed candidate and preflight

The approved candidate is
`ghcr.io/denischernykh/nest-js-starter@sha256:84d0fdb162020eea35113c9b05071f61179e01a6f47a7ea088b69cead393d112`
at revision `ddfacb316ecb721e4e0a7d2967816b8bbfd875f0`. Never substitute a tag,
including a commit-SHA tag, for this digest.

Before a change window:

1. Confirm that the Stage workflow for revision
   `ddfacb316ecb721e4e0a7d2967816b8bbfd875f0` succeeded, published the exact
   digest above, and recorded a passing OCI smoke and vulnerability gate.
2. Pull and inspect that immutable reference from a controlled operator host.
   Require `org.opencontainers.image.revision` to equal the exact revision.
   Also record the image digest and the OCI source label as incident evidence.
3. Confirm that the API runtime identity is least-privilege and cannot run
   Prisma migrations. Keep migration credentials separate from API runtime
   credentials; do not print either connection URL.
4. Check that the candidate is compatible with the currently applied schema.
   If a rollback may be needed, also establish that the previous API image is
   compatible with the schema after this promotion.

```sh
candidate_image='ghcr.io/denischernykh/nest-js-starter@sha256:84d0fdb162020eea35113c9b05071f61179e01a6f47a7ea088b69cead393d112'
candidate_revision='ddfacb316ecb721e4e0a7d2967816b8bbfd875f0'

docker pull "$candidate_image"
docker image inspect "$candidate_image" \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
  | grep -Fx "$candidate_revision"
```

If the Stage run, digest, revision label, OCI checks, runtime-role separation,
or compatibility review cannot be proven, stop. Do not configure a provider or
start an API deployment.

## Order of change

1. Freeze concurrent deployments and capture the previous API digest as the
   rollback candidate.
2. Configure the candidate digest in the deployment adapter.
3. Run the one-shot migrator with the migration role.
4. Only after the migrator exits successfully, mutate the API deployment.
5. Wait for one identified deployment to reach its terminal state.
6. Run the external smoke checks below.

The API image must not be changed after any migrator failure. Preserve the
failed migrator logs and diagnose the database or migration; do not retry by
starting the API or by attempting an automatic down-migration.

`docs/runbooks/dokploy-deployment.md` supplies the Dokploy adapter calls and
bounded polling. `docs/runbooks/rollback.md` supplies the response to a failed
deployment or smoke check.

## External smoke after a successful deployment

Use the public Stage base URL supplied by the operator. It is intentionally
read from the environment so that no environment URL is committed or printed.
All three health endpoints must return `200`; `/v1/auth/me` without a cookie
must return the RFC 9457 authentication problem, not a redirect or HTML page.

```sh
: "${STAGE_BASE_URL:?set the public Stage base URL}"
stage_base_url="${STAGE_BASE_URL%/}"

curl --fail-with-body --silent --show-error "$stage_base_url/health/live"
curl --fail-with-body --silent --show-error "$stage_base_url/health/startup"
curl --fail-with-body --silent --show-error "$stage_base_url/health/ready"

auth_body="$(mktemp)"
auth_headers="$(mktemp)"
trap 'rm -f "$auth_body" "$auth_headers"' EXIT
auth_status="$(curl --silent --show-error --output "$auth_body" \
  --dump-header "$auth_headers" --write-out '%{http_code}' \
  "$stage_base_url/v1/auth/me")"
test "$auth_status" = '401'
grep -qi '^content-type: application/problem+json' "$auth_headers"
jq -e '.code == "AUTHENTICATION_REQUIRED" and .status == 401' "$auth_body" >/dev/null
```

Any HTTP transport/API error, a non-`done` deployment status, polling timeout,
or failed smoke is a failed promotion. Do not treat `running`, a missing status,
or an unknown status as success. Keep the response/log evidence free of
cookies, credentials, connection URLs and user data, then enter the rollback
or roll-forward decision in `docs/runbooks/rollback.md`.
