# PostgreSQL backup and isolated restore validation

This document describes an environment-owned backup job and a restore drill
into a newly created, isolated database. It is isolated from production promotion.
The production path remains the tracked Compose project with
POSTGRES_ADMIN_USER, POSTGRES_ADMIN_PASSWORD,
POSTGRES_MIGRATOR_USER/POSTGRES_MIGRATOR_PASSWORD and
POSTGRES_RUNTIME_USER/POSTGRES_RUNTIME_PASSWORD. Historical
MIGRATION_DATABASE_URL and RUNTIME_DATABASE_URL names are not canonical
production inputs.

## Backup policy

The environment-owned scheduler runs one backup at a time, retains the newest
14 complete off-host archive/sidecar pairs and alerts on every non-zero step.
The backup identity is a UTC timestamp. S3 credentials, bucket, prefix and
PostgreSQL connection settings are secret-manager inputs and are never printed.
Cleanup may remove only the exact incomplete archive/sidecar keys for the
current backup ID or explicitly identified expired pairs.

The isolated backup service uses a read-only backup identity and a protected
service entry. Its admin identity is recorded by name as POSTGRES_ADMIN_USER;
credentials are injected, not committed or passed in argv:

    set -eu
    set +x
    : "$S3_BACKUP_BUCKET"
    : "$S3_BACKUP_PREFIX"
    backup_id="$(date -u +%Y%m%dT%H%M%SZ)"
    workdir="$(mktemp -d "${TMPDIR:-/tmp}/nest-js-starter-pg-backup.XXXXXX")"
    PGSERVICE=backup-source pg_dump --format=custom --no-owner --no-privileges --file "$workdir/nest-js-starter-$backup_id.dump"
    pg_restore --list "$workdir/nest-js-starter-$backup_id.dump" >/dev/null
    shasum -a 256 "$workdir/nest-js-starter-$backup_id.dump" >"$workdir/nest-js-starter-$backup_id.dump.sha256"

Upload the archive and sidecar separately, then verify both remote objects and
the checksum. Never use a broad recursive delete or count an incomplete pair as
published.

## Restore drill — new database only

Run quarterly and after material database-platform changes. Choose the latest
complete pair, generate a unique restore_db, and refuse if it equals the source
database. The restore target is never production:

    set -eu
    set +x
    restore_run_id="$(date -u +%Y%m%dT%H%M%SZ)"
    restore_db="nest_js_starter_restore_$restore_run_id"
    workdir="$(mktemp -d "${TMPDIR:-/tmp}/nest-js-starter-pg-restore.XXXXXX")"
    pg_restore --list "$workdir/$BACKUP_ARCHIVE" >/dev/null
    PGSERVICE=restore-admin psql --no-psqlrc --set=ON_ERROR_STOP=1 --dbname=postgres \
      --command "SELECT 1 FROM pg_database WHERE datname = '$restore_db'"
    PGSERVICE=restore-admin createdb "$restore_db"
    PGSERVICE=restore-migrator pg_restore --exit-on-error --no-owner --no-privileges --dbname="$restore_db" "$workdir/$BACKUP_ARCHIVE"

RESTORE_* values are secret-injected aliases for this isolated target only.
They are not application deployment inputs. Do not use --clean, do not select
the source database, and do not start the public API.

## Representative verification

Check aggregate state only and do not print application rows or credentials:

    PGSERVICE=restore-verifier psql --no-psqlrc --set=ON_ERROR_STOP=1 --dbname="$restore_db" <<'SQL'
    SELECT count(*) AS applied_migrations
    FROM public._prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
    SQL

The isolated restore validation must also prove the runtime role cannot create
a table:

    if PGSERVICE=restore-runtime psql --no-psqlrc --set=ON_ERROR_STOP=1 \
      --dbname="$restore_db" \
      --command 'CREATE TABLE public.restore_runtime_ddl_probe (id integer)' \
      >/dev/null 2>&1; then
      printf '%s\n' 'unexpected: runtime role created a table' >&2
      exit 1
    fi
    printf '%s\n' 'runtime DDL denial verified'

This recovery reference does not promote an image, run the production migrator,
change a production database, or claim hosted readiness.
