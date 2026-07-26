# Rollback or roll-forward after a failed Stage promotion

Use this procedure after an API error, Dokploy API error, polling timeout,
terminal deployment failure, or failed external smoke from
<code>docs/runbooks/deployment.md</code>. Do not erase deployment logs, HTTP
evidence or the pre-change digest. Redact cookies, credentials, connection URLs
and user data from the incident record.

## Fixed rollback candidate and decision point

The approved rollback image is supplied through <code>PREVIOUS_IMAGE_REF</code>
and must be the immutable GHCR digest for revision
<code>913fef3124b5ec3b2aee3505dcc7ad96052d24e2</code>. Never replace it with a
mutable tag. Keep the API's existing <code>RUNTIME_DATABASE_URL</code>; an image
rollback does not grant the runtime role migration privileges.

Before changing the API again, determine whether this previous API revision is
compatible with the schema now present in the database. Do not run a Prisma
down-migration. If compatibility is proven, use the exact-digest image rollback
below. If the promotion introduced a schema change that the rollback API cannot
read safely, image rollback is forbidden: keep the affected API out of service
as required by the incident policy and roll forward with a newly reviewed,
published immutable image that is compatible with the current schema.

This decision applies even when the failure was external smoke rather than a
Dokploy terminal failure. A healthy <code>done</code> deployment is insufficient
if the public contract is unhealthy.

## Exact-digest rollback

1. Freeze concurrent deployments and record the failing candidate digest,
   deployment ID/status, migration result and smoke result.
2. Pull the rollback image and verify its
   <code>org.opencontainers.image.revision</code> label is exactly
   <code>913fef3124b5ec3b2aee3505dcc7ad96052d24e2</code>.
3. Set <code>CANDIDATE_IMAGE_REF</code> to the exact value of
   <code>PREVIOUS_IMAGE_REF</code> and run the environment-only
   <code>application.saveDockerProvider</code> request in
   <code>docs/runbooks/dokploy-deployment.md</code> (using the rollback revision
   in its local <code>candidate_revision</code> value).
4. Do not invoke the migrator for an image rollback. The API runtime account
   remains unable to mutate schema.
5. Use <code>application.deploy</code>, snapshot <code>deployment.all</code>
   before/after, identify exactly one new deployment ID, and poll only that ID
   at five-second intervals until the ten-minute deadline. <code>done</code>
   alone is success; <code>error</code> and <code>cancelled</code> are terminal
   failures. Missing, duplicate or unknown state fails closed.
6. Repeat all external checks using <code>PUBLIC_API_URL</code>:
   <code>/health/live</code>, <code>/health/startup</code> and
   <code>/health/ready</code> must be <code>200</code>, and unauthenticated
   <code>/v1/auth/me</code> must be a <code>401</code>
   <code>application/problem+json</code> response with
   <code>AUTHENTICATION_REQUIRED</code> and JSON <code>status: 401</code>.

```sh
set -eu

test -n "$PREVIOUS_IMAGE_REF" || {
  echo 'PREVIOUS_IMAGE_REF is required' >&2
  exit 1
}
previous_revision='913fef3124b5ec3b2aee3505dcc7ad96052d24e2'
printf '%s' "$PREVIOUS_IMAGE_REF" | grep -Eq '@sha256:[[:xdigit:]]{64}$' || {
  echo 'PREVIOUS_IMAGE_REF must be an immutable digest reference' >&2
  exit 1
}

docker pull "$PREVIOUS_IMAGE_REF"
docker image inspect "$PREVIOUS_IMAGE_REF" \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
  | grep -Fx "$previous_revision"
```

## Failure handling

- **Migrator failure before API mutation:** leave the previous API image in
  place; diagnose migration/database access. There is nothing to roll back in
  the API deployment.
- **Dokploy API error, timeout or terminal failure:** fail closed, preserve the
  exact deployment record/logs, then make the schema-compatibility decision
  above. Do not select an arbitrary newest deployment record.
- **External smoke failure after <code>done</code>:** treat promotion as failed.
  Roll back only if the old image is schema-compatible; otherwise begin a
  reviewed roll-forward using an immutable digest.
- **Rollback smoke failure:** stop automatic retries, keep the incident open,
  retain the evidence, and escalate for a compatible forward fix. Do not claim
  recovery based only on a successful Dokploy mutation response.

Record the final image digest, OCI revision label, migration outcome,
identified deployment ID and the four smoke outcomes. The record is evidence of
an executed operator action; this runbook itself is not such evidence.
