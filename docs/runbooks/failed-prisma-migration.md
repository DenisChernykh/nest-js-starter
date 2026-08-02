# Failed Prisma migration runbook

## Stop condition

The migration gate is a one-shot operation between digest verification and API
deployment. A non-zero `pnpm start:migrate` result is a hard
stop: do not start, restart, replace, or roll out an API revision. Keep the
previous API revision serving. Never run prisma migrate reset, never edit
_prisma_migrations, and never apply a database down-migration.

The commands below accept only secret-injected variables and discard Prisma
output from the deliberate failure. They neither display connection URLs nor
persist them in a log or shell history. Disable shell tracing before every
command that handles a credential.

## Controlled failure drill

Run this drill in an isolated non-production environment while a known-good API
revision is already ready. Do not create, commit, or apply a broken migration.
The deployment controller temporarily sets the canonical `MIGRATION_DATABASE_URL`
to an invalid migration connection input; it must not be the runtime or source
database connection. `PUBLIC_API_URL` identifies the already-running API.

```bash
set -eu
set +x
: "$MIGRATION_DATABASE_URL"
: "$PUBLIC_API_URL"
[ "${PUBLIC_API_URL%/}" = "$PUBLIC_API_URL" ] || {
  printf '%s\n' 'PUBLIC_API_URL must not end in a slash' >&2
  exit 64
}

# Prove the current revision is ready before the failed one-shot operation.
curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
  --output /dev/null \
  "$PUBLIC_API_URL/health/ready"

# The failure is expected. Output is intentionally discarded so a driver cannot
# accidentally expose a connection setting. No API deployment command appears
# in this drill.
export DATABASE_URL="$MIGRATION_DATABASE_URL"
if pnpm start:migrate >/dev/null 2>&1; then
  printf '%s\n' 'unexpected: invalid migrator input succeeded' >&2
  exit 1
fi

# The same already-running API revision must still be ready afterwards.
curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
  --output /dev/null \
  "$PUBLIC_API_URL/health/ready"
printf '%s\n' 'controlled migration failure isolated; previous API stayed ready'
```

Record the tested image digest, UTC timestamps, the two successful readiness
status checks, and the expected non-zero migrator exit in the environment-owned
change record. Do not record the temporary input, a connection URL, secrets, or
response bodies. The absence of an API deployment is evidenced by this
procedure invoking no API deployment command; a hosted deployment audit must
also show no new API rollout event.

## Real migration failure response

1. Freeze promotion. Keep the previous verified API digest running and do not
   attempt an application rollback that changes the database.
2. Preserve the failing migration artifact, exact image digest, UTC time, and
   sanitized Prisma error class. Do not paste driver output containing a URL.
3. Make a new off-host backup before any remediation, following
   [postgres-backup-restore.md](postgres-backup-restore.md). Restore it only
   into a separate database for investigation.
4. Inspect migration state with the migrator credential. This command is
   read-only and does not print a connection URL:

   ```bash
   set -eu
   set +x
   : "$MIGRATION_DATABASE_URL"
   export DATABASE_URL="$MIGRATION_DATABASE_URL"
   pnpm exec prisma migrate status --config prisma.config.ts
   ```

5. Reproduce and diagnose against the separate restored database. Decide the
   forward-only repair in review: it may be a corrected new migration, a
   narrowly approved data repair, or a documented prisma migrate resolve action
   after the actual database state is proven. migrate resolve changes migration
   history, so it is not a first response and must name the failed migration
   explicitly in the approved change record.
6. Build and verify a new immutable image digest. Run the one-shot migrator
   with the real migrator credential. Only after it succeeds may the API use the
   runtime credential and continue its bounded readiness and external smoke
   gates.

Prisma's production command is migrate deploy; it applies pending committed
migrations but does not reset the database. A failed migration is therefore a
promotion failure, not permission to mutate history manually or to run a
destructive reset.
