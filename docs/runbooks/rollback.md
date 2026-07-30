# Explicit rollback or roll-forward decision

Use this procedure after a failed Stage promotion, terminal Dokploy failure,
polling timeout or failed external smoke. Preserve the promotion evidence,
deployment records and public observations. Redact credentials, connection
URLs, complete environments, cookies and user data.

The promotion CLI performs no automatic rollback. This runbook requires a new
human decision and a separate explicit command.

## Schema compatibility gate

Before any rollback call, prove that the distinct rollback image in the release
manifest can safely run against the database schema left by the candidate
migration. The manifest's `schemaCompatibilityEvidence` must reference that
review.

There is **no down-migration** in this procedure. If the previous API cannot
read the current schema, image rollback is forbidden. Keep the incident open
and roll forward with a newly reviewed immutable image compatible with the
current schema.

This gate applies even when Dokploy reached `done`: an unhealthy public
health/auth contract is still a failed promotion.

## Explicit rollback command

Freeze concurrent deployments and use the same protected manifest/live inputs
as the promotion:

```sh
pnpm deployment:rollback -- --manifest /protected/path/release.json \
  --apply \
  --evidence /protected/path/rollback-evidence.json
```

The rollback command:

1. rejects empty schema-compatibility evidence before an external call;
2. authenticates to private GHCR in an isolated temporary Docker config;
3. pulls the exact rollback digest and verifies its OCI revision;
4. does not invoke the migrator;
5. snapshots current Dokploy deployment records;
6. restores `DOKPLOY_PREVIOUS_APPLICATION_ENV`;
7. saves the exact rollback digest as the Docker provider;
8. deploys with a rollback-revision-bound title;
9. identifies exactly one new record and polls only it to `done`;
10. repeats all external health/auth smoke checks;
11. atomically writes redacted rollback evidence without overwriting an
    existing file.

The command contains no automatic rollback path of its own. A failure after
environment mutation triggers one bounded attempt to save the protected
previous environment again, records that outcome and stops.

## Outcomes

- **Rollback succeeds:** record the exact rollback digest/revision, identified
  deployment ID, terminal status and four smoke outcomes. Keep the incident
  open until the human recovery criteria are met.
- **Rollback image verification fails:** no Dokploy mutation occurred. Diagnose
  registry access or artifact identity.
- **Dokploy or smoke fails:** preserve the new failure evidence; do not select
  an arbitrary newest deployment and do not loop automatic retries.
- **Schema compatibility is uncertain:** do not run the command; choose a
  reviewed roll-forward.

Local unit/mock tests and this runbook are not proof of recovery on a hosted
environment.
