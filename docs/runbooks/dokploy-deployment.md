# Dokploy adapter for an immutable Stage image

This is a manual adapter procedure; it does not claim that a live Dokploy
execution occurred. The current official Dokploy OpenAPI defines
`application.saveDockerProvider`, `application.deploy` and `deployment.all`.
Its generated response schemas for these operations are empty objects, so this
runbook does not invent a response body for either mutation. The official
source shows that `deployment.all` returns deployment records with
`deploymentId` and `status`; statuses are `running`, `done`, `error` and
`cancelled`.

Sources: [Dokploy OpenAPI](https://raw.githubusercontent.com/Dokploy/dokploy/canary/openapi.json)
and [Dokploy deployment schema](https://raw.githubusercontent.com/Dokploy/dokploy/canary/packages/server/src/db/schema/deployment.ts).

## Environment and safety boundary

Use a short-lived API token with only the permissions needed for this
application. Read all secrets and Dokploy-specific values from the operator
environment. Do not use shell tracing (`set -x`), literal tokens in commands,
or saved request payloads containing registry credentials.

```sh
: "${DOKPLOY_URL:?set the Dokploy base URL}"
: "${DOKPLOY_TOKEN:?set the short-lived Dokploy API token}"
: "${DOKPLOY_APPLICATION_ID:?set the target application ID}"
: "${DOKPLOY_REGISTRY_URL:?set the registry URL}"
: "${DOKPLOY_REGISTRY_USERNAME:?set the registry username}"
: "${DOKPLOY_REGISTRY_PASSWORD:?set the registry password}"

dokploy_url="${DOKPLOY_URL%/}"
candidate_image='ghcr.io/denischernykh/nest-js-starter@sha256:84d0fdb162020eea35113c9b05071f61179e01a6f47a7ea088b69cead393d112'
candidate_revision='ddfacb316ecb721e4e0a7d2967816b8bbfd875f0'
deployment_title="stage-${candidate_revision}"
```

The examples use the REST paths under Dokploy's documented `/api` base. Abort
on any `curl` API error (`4xx`/`5xx`), malformed JSON, or unexpected response
shape. Such errors are diagnostic events, not a cue to retry indefinitely.

## Save the exact image, then run the migrator

First save the provider configuration with the candidate's immutable digest.
The JSON is built locally; secrets are expanded from environment variables and
never appear as literal command arguments.

```sh
provider_payload="$(jq -n \
  --arg applicationId "$DOKPLOY_APPLICATION_ID" \
  --arg dockerImage "$candidate_image" \
  --arg registryUrl "$DOKPLOY_REGISTRY_URL" \
  --arg username "$DOKPLOY_REGISTRY_USERNAME" \
  --arg password "$DOKPLOY_REGISTRY_PASSWORD" \
  '{applicationId: $applicationId, dockerImage: $dockerImage, registryUrl: $registryUrl, username: $username, password: $password}')"

printf '%s' "$provider_payload" | curl --fail-with-body --silent --show-error \
  --request POST "$dokploy_url/api/application.saveDockerProvider" \
  --header 'accept: application/json' \
  --header "authorization: Bearer $DOKPLOY_TOKEN" \
  --header 'content-type: application/json' \
  --data-binary @- >/dev/null
unset provider_payload
```

Run the one-shot migrator through the separately configured migration role and
wait for a zero exit status. This API deployment procedure begins only after
that succeeds. On a migration error, stop before calling `application.deploy`.
Do not change the API image, and follow the failed-migration diagnostic policy.

## Snapshot, deploy and identify exactly one record

Before deployment, capture the deployment IDs. The title/description make the
new record distinguishable, but the maintenance window must prevent concurrent
deploys. If the post-deploy list does not contain exactly one new record with
the expected title, fail closed; do not poll the newest arbitrary record.

```sh
before_deployments="$(mktemp)"
after_deployments="$(mktemp)"
trap 'rm -f "$before_deployments" "$after_deployments"' EXIT

curl --fail-with-body --silent --show-error \
  --get "$dokploy_url/api/deployment.all" \
  --header 'accept: application/json' \
  --header "authorization: Bearer $DOKPLOY_TOKEN" \
  --data-urlencode "applicationId=$DOKPLOY_APPLICATION_ID" >"$before_deployments"
jq -e 'type == "array" and all(.[]; (.deploymentId | type) == "string" and (.status | type) == "string")' \
  "$before_deployments" >/dev/null

deploy_payload="$(jq -n \
  --arg applicationId "$DOKPLOY_APPLICATION_ID" \
  --arg title "$deployment_title" \
  --arg description "immutable digest $candidate_image" \
  '{applicationId: $applicationId, title: $title, description: $description}')"
curl --fail-with-body --silent --show-error \
  --request POST "$dokploy_url/api/application.deploy" \
  --header 'accept: application/json' \
  --header "authorization: Bearer $DOKPLOY_TOKEN" \
  --header 'content-type: application/json' \
  --data "$deploy_payload" >/dev/null
unset deploy_payload

curl --fail-with-body --silent --show-error \
  --get "$dokploy_url/api/deployment.all" \
  --header 'accept: application/json' \
  --header "authorization: Bearer $DOKPLOY_TOKEN" \
  --data-urlencode "applicationId=$DOKPLOY_APPLICATION_ID" >"$after_deployments"

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
deadline. `running` is the only non-terminal status. `done` is the only
success; `error` and `cancelled` are terminal failures. Missing/unknown status,
missing/duplicate deployment ID, bad API response, and deadline expiry fail
closed and go to diagnostics plus the rollback/roll-forward decision.

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

  poll_response="$(curl --fail-with-body --silent --show-error \
    --get "$dokploy_url/api/deployment.all" \
    --header 'accept: application/json' \
    --header "authorization: Bearer $DOKPLOY_TOKEN" \
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

After `done`, perform the external health and unauthenticated-auth smoke in
`docs/runbooks/deployment.md`. Never infer success from the mutation response,
from `running`, or from a different deployment record.
