# Dokploy adapter for an immutable Stage image

This is a manual adapter procedure; it does not claim that a live Dokploy
execution occurred. The current official Dokploy OpenAPI defines
<code>application.saveDockerProvider</code>, <code>application.deploy</code> and
<code>deployment.all</code>. Its generated response schemas for these
operations are empty objects, so this runbook does not invent a response body
for either mutation. The official source shows that <code>deployment.all</code>
returns deployment records with <code>deploymentId</code> and
<code>status</code>; statuses are <code>running</code>, <code>done</code>,
<code>error</code> and <code>cancelled</code>.

Sources: [Dokploy OpenAPI](https://raw.githubusercontent.com/Dokploy/dokploy/canary/openapi.json)
and [Dokploy deployment schema](https://raw.githubusercontent.com/Dokploy/dokploy/canary/packages/server/src/db/schema/deployment.ts).

## Environment and safety boundary

Use a short-lived API key with only the permissions needed for this
application. Read all secrets and Dokploy-specific values from the operator
environment. Do not use shell tracing (<code>set -x</code>), literal tokens in
commands, or saved request payloads containing registry credentials. The API
runtime must be configured with <code>DATABASE_URL</code> resolved from
<code>RUNTIME_DATABASE_URL</code>; the migrator command below is the only
consumer of <code>MIGRATION_DATABASE_URL</code>.

```sh
# Disable tracing before expanding any secret variable.
set -eu
set +x

test -n "$DOKPLOY_BASE_URL" || {
  echo 'DOKPLOY_BASE_URL is required' >&2
  exit 1
}
test -n "$DOKPLOY_API_KEY" || {
  echo 'DOKPLOY_API_KEY is required' >&2
  exit 1
}
test -n "$DOKPLOY_APPLICATION_ID" || {
  echo 'DOKPLOY_APPLICATION_ID is required' >&2
  exit 1
}
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
test -n "$GHCR_REGISTRY_URL" || {
  echo 'GHCR_REGISTRY_URL is required' >&2
  exit 1
}
test -n "$GHCR_USERNAME" || {
  echo 'GHCR_USERNAME is required' >&2
  exit 1
}
test -n "$GHCR_PASSWORD" || {
  echo 'GHCR_PASSWORD is required' >&2
  exit 1
}

dokploy_base_url="$(printf '%s' "$DOKPLOY_BASE_URL" | sed 's:/$::')"
approved_candidate_image_ref='ghcr.io/denischernykh/nest-js-starter@sha256:84d0fdb162020eea35113c9b05071f61179e01a6f47a7ea088b69cead393d112'
candidate_revision='ddfacb316ecb721e4e0a7d2967816b8bbfd875f0'
deployment_title="stage-$candidate_revision"
test "$CANDIDATE_IMAGE_REF" = "$approved_candidate_image_ref" || {
  echo 'CANDIDATE_IMAGE_REF is not the approved immutable candidate' >&2
  exit 1
}

# Keep the API key out of curl's argv and logs. The config file is removed on
# normal exit and signals.
umask 077
dokploy_curl_config="$(mktemp)"
chmod 600 "$dokploy_curl_config"
printf 'header = "x-api-key: %s"\n' "$DOKPLOY_API_KEY" \
  >"$dokploy_curl_config"
before_deployments=''
after_deployments=''
dokploy_cleanup() {
  rm -f -- "$dokploy_curl_config" "$before_deployments" "$after_deployments"
}
trap dokploy_cleanup EXIT HUP INT TERM
dokploy_curl() {
  curl --config "$dokploy_curl_config" --fail-with-body --silent --show-error "$@"
}
```

The temporary config contains the API key and has mode <code>0600</code>. Every
Dokploy request below passes only its path to curl; the key is never placed in
a curl argument. Abort on any <code>curl</code> API error
(<code>4xx</code>/<code>5xx</code>), malformed JSON, or unexpected response
shape. Such errors are diagnostic events, not a cue to retry indefinitely.

## Run the migrator before changing Dokploy

First run the one-shot migrator with the migration role and wait for a zero
exit status. The repository's Prisma config maps <code>DATABASE_URL</code> to
the canonical <code>MIGRATION_DATABASE_URL</code> input:

```sh
DATABASE_URL="$MIGRATION_DATABASE_URL" \
  corepack pnpm@11.15.1 start:migrate
```

Only after this command succeeds may the operator save the candidate provider
and call <code>application.deploy</code>. On a migration error, stop before
changing the API image, preserve the redacted failure evidence, and follow the
failed-migration diagnostic policy. Do not run an automatic down-migration.

## Save the exact image provider

The JSON is built locally; values are read by <code>jq</code> from the inherited
environment so registry credentials never appear as command arguments. The
runtime application environment must already bind <code>DATABASE_URL</code> to
<code>RUNTIME_DATABASE_URL</code> before the API deployment is started.

```sh
provider_payload="$(jq -n '
  {
    applicationId: env.DOKPLOY_APPLICATION_ID,
    dockerImage: env.CANDIDATE_IMAGE_REF,
    registryUrl: env.GHCR_REGISTRY_URL,
    username: env.GHCR_USERNAME,
    password: env.GHCR_PASSWORD
  }
')"

printf '%s' "$provider_payload" | dokploy_curl \
  --request POST "$dokploy_base_url/api/application.saveDockerProvider" \
  --header 'accept: application/json' \
  --header 'content-type: application/json' \
  --data-binary @- >/dev/null
unset provider_payload
```

## Snapshot, deploy and identify exactly one record

Before <code>application.deploy</code>, capture the deployment IDs. The
title/description make the new record distinguishable, but the maintenance
window must prevent concurrent deploys. If the post-deploy list does not contain
exactly one new record with the expected title, fail closed; do not poll the
newest arbitrary record.

```sh
before_deployments="$(mktemp)"
after_deployments="$(mktemp)"

dokploy_curl \
  --get "$dokploy_base_url/api/deployment.all" \
  --header 'accept: application/json' \
  --data-urlencode "applicationId=$DOKPLOY_APPLICATION_ID" \
  >"$before_deployments"
jq -e 'type == "array" and all(.[]; (.deploymentId | type) == "string" and (.status | type) == "string")' \
  "$before_deployments" >/dev/null

deploy_payload="$(jq -n \
  --arg applicationId "$DOKPLOY_APPLICATION_ID" \
  --arg title "$deployment_title" \
  --arg description "immutable digest $CANDIDATE_IMAGE_REF" \
  '{applicationId: $applicationId, title: $title, description: $description}')"
dokploy_curl \
  --request POST "$dokploy_base_url/api/application.deploy" \
  --header 'accept: application/json' \
  --header 'content-type: application/json' \
  --data "$deploy_payload" >/dev/null
unset deploy_payload

dokploy_curl \
  --get "$dokploy_base_url/api/deployment.all" \
  --header 'accept: application/json' \
  --data-urlencode "applicationId=$DOKPLOY_APPLICATION_ID" \
  >"$after_deployments"

deployment_id="$(jq -er --slurpfile before "$before_deployments" --arg title "$deployment_title" '
  if type != "array" then error("deployment.all did not return an array") else . end
  | [ .[] as $deployment
      | select(($deployment.deploymentId | type) == "string")
      | select(($deployment.status | type) == "string")
      | select($deployment.title == $title)
      | select([ $before[0][]?.deploymentId ] | index($deployment.deploymentId) | not)
      | $deployment ]
  | if length == 1 then .[0].deploymentId else error("new deployment is not unambiguous") end
' "$after_deployments")"
```

## Poll the identified deployment only

The local policy is a five-second interval and one ten-minute absolute
deadline. <code>running</code> is the only non-terminal status. <code>done</code>
is the only success; <code>error</code> and <code>cancelled</code> are terminal
failures. Missing/unknown status, missing/duplicate deployment ID, bad API
response, and deadline expiry fail closed and go to diagnostics plus the
rollback/roll-forward decision.

```sh
poll_interval_seconds=5
poll_deadline_seconds=600
deadline="$(( $(date +%s) + poll_deadline_seconds ))"
while :; do
  now="$(date +%s)"
  test "$now" -lt "$deadline" || {
    echo 'Dokploy deployment polling deadline exceeded' >&2
    exit 1
  }

  poll_response="$(dokploy_curl \
    --get "$dokploy_base_url/api/deployment.all" \
    --header 'accept: application/json' \
    --data-urlencode "applicationId=$DOKPLOY_APPLICATION_ID")"
  status="$(printf '%s' "$poll_response" | jq -er --arg id "$deployment_id" '
    if type != "array" then error("deployment.all did not return an array") else . end
    | [ .[] | select(.deploymentId == $id) ]
    | if length == 1 and (.[0].status | type) == "string"
      then .[0].status
      else error("identified deployment is missing, duplicate, or lacks status")
      end
  ')"

  case "$status" in
    done) break ;;
    running) sleep "$poll_interval_seconds" ;;
    error|cancelled)
      echo "Dokploy deployment ended with $status" >&2
      exit 1
      ;;
    *)
      echo "Dokploy deployment has unknown status: $status" >&2
      exit 1
      ;;
  esac
done
```

After <code>done</code>, perform the external health and unauthenticated-auth
smoke in <code>docs/runbooks/deployment.md</code>. Never infer success from the
mutation response, from <code>running</code>, or from a different deployment
record.
