# Rollback or roll-forward after a failed Stage promotion

Use this procedure after an API error, Dokploy API error, polling timeout,
terminal deployment failure, or failed external smoke from
`docs/runbooks/deployment.md`. Do not erase deployment logs, HTTP evidence or
the pre-change digest. Redact cookies, credentials, connection URLs and user
data from the incident record.

## Fixed rollback candidate and decision point

The approved rollback image is
`ghcr.io/denischernykh/nest-js-starter@sha256:638771d48518551401c09a3da432d0e5c5462fc4c441b0780330bee6df8fcf6e`
at revision `913fef3124b5ec3b2aee3505dcc7ad96052d24e2`. It is an immutable
reference; never replace it with a mutable tag.

Before changing the API again, determine whether this previous API revision is
compatible with the schema now present in the database. Do not run a Prisma
down-migration. If compatibility is proven, use the exact-digest image rollback
below. If the promotion introduced a schema change that the rollback API cannot
read safely, image rollback is forbidden: keep the affected API out of service
as required by the incident policy and roll forward with a newly reviewed,
published immutable image that is compatible with the current schema.

This decision applies even when the failure was external smoke rather than a
Dokploy terminal failure. A healthy `done` deployment is insufficient if the
public contract is unhealthy.

## Exact-digest rollback

1. Freeze concurrent deployments and record the failing candidate digest,
   deployment ID/status, migration result and smoke result.
2. Pull the rollback image and verify its
   `org.opencontainers.image.revision` label is exactly
   `913fef3124b5ec3b2aee3505dcc7ad96052d24e2`.
3. Configure the Dokploy Docker provider with this exact image digest using
   the environment-only `application.saveDockerProvider` request in
   `docs/runbooks/dokploy-deployment.md` (replace only `candidate_image` and
   `candidate_revision` with the rollback values).
4. Do not invoke the migrator for an image rollback. The API runtime account
   remains unable to mutate schema.
5. Use `application.deploy`, snapshot `deployment.all` before/after, identify
   exactly one new deployment ID, and poll only that ID at five-second intervals
   until the ten-minute deadline. `done` alone is success; `error` and
   `cancelled` are terminal failures. Missing, duplicate or unknown state fails
   closed.
6. Repeat all external checks: `/health/live`, `/health/startup`,
   `/health/ready` must be `200`, and unauthenticated `/v1/auth/me` must be a
   `401` `application/problem+json` response with
   `AUTHENTICATION_REQUIRED` and JSON `status: 401`.

```sh
rollback_image='ghcr.io/denischernykh/nest-js-starter@sha256:638771d48518551401c09a3da432d0e5c5462fc4c441b0780330bee6df8fcf6e'
rollback_revision='913fef3124b5ec3b2aee3505dcc7ad96052d24e2'

docker pull "$rollback_image"
docker image inspect "$rollback_image" \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
  | grep -Fx "$rollback_revision"
```

## Failure handling

- **Migrator failure before API mutation:** leave the previous API image in
  place; diagnose migration/database access. There is nothing to roll back in
  the API deployment.
- **Dokploy API error, timeout or terminal failure:** fail closed, preserve the
  exact deployment record/logs, then make the schema-compatibility decision
  above. Do not select an arbitrary newest deployment record.
- **External smoke failure after `done`:** treat promotion as failed. Roll back
  only if the old image is schema-compatible; otherwise begin a reviewed
  roll-forward using an immutable digest.
- **Rollback smoke failure:** stop automatic retries, keep the incident open,
  retain the evidence, and escalate for a compatible forward fix. Do not claim
  recovery based only on a successful Dokploy mutation response.

Record the final image digest, OCI revision label, migration outcome,
identified deployment ID and the four smoke outcomes. The record is evidence
of an executed operator action; this runbook itself is not such evidence.
