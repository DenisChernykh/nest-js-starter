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
    archive_name="nest-js-starter-$backup_id.dump"
    cleanup_backup_workdir() {
      rm -f -- "$workdir/$archive_name" "$workdir/$archive_name.sha256"
      rmdir "$workdir" 2>/dev/null || true
    }
    trap cleanup_backup_workdir EXIT
    trap 'exit 129' HUP
    trap 'exit 130' INT
    trap 'exit 143' TERM
    PGSERVICE=backup-source pg_dump --format=custom --no-owner --no-privileges --file "$workdir/$archive_name"
    pg_restore --list "$workdir/$archive_name" >/dev/null
    (cd "$workdir" && shasum -a 256 "$archive_name" >"$archive_name.sha256")
    aws s3 cp "$workdir/$archive_name" "s3://$S3_BACKUP_BUCKET/$S3_BACKUP_PREFIX/$archive_name"
    aws s3 cp "$workdir/$archive_name.sha256" "s3://$S3_BACKUP_BUCKET/$S3_BACKUP_PREFIX/$archive_name.sha256"
    aws s3api head-object --bucket "$S3_BACKUP_BUCKET" --key "$S3_BACKUP_PREFIX/$archive_name" >/dev/null
    aws s3api head-object --bucket "$S3_BACKUP_BUCKET" --key "$S3_BACKUP_PREFIX/$archive_name.sha256" >/dev/null
    cleanup_backup_workdir
    trap - EXIT HUP INT TERM

Upload the archive and sidecar separately, then verify both remote objects and
the checksum. Never use a broad recursive delete or count an incomplete pair as
published.

## Restore drill — new database only

Run quarterly and after material database-platform changes. Use an isolated
PostgreSQL instance/cluster so the cluster-wide app_migrator and app_runtime
roles cannot affect production. The restore-migrator and restore-runtime service
entries map to those exact role names. Choose a complete off-host archive/sidecar
pair, generate a unique restore_db, and refuse if it equals the source database:

    set -eu
    set +x
    : "$S3_BACKUP_BUCKET"
    : "$S3_BACKUP_PREFIX"
    : "$BACKUP_ARCHIVE"
    : "$RESTORE_MIGRATOR_PASSWORD"
    : "$RESTORE_RUNTIME_PASSWORD"
    if [[ ! "$BACKUP_ARCHIVE" =~ ^nest-js-starter-[0-9]{8}T[0-9]{6}Z[.]dump$ ]]; then
      printf '%s\n' 'invalid backup archive name' >&2
      exit 1
    fi
    restore_run_id="$(date -u +%Y%m%dT%H%M%SZ)"
    restore_db="nest_js_starter_restore_$restore_run_id"
    workdir="$(mktemp -d "${TMPDIR:-/tmp}/nest-js-starter-pg-restore.XXXXXX")"
    cleanup_restore_workdir() {
      rm -f -- "$workdir/$BACKUP_ARCHIVE" "$workdir/$BACKUP_ARCHIVE.sha256"
      rmdir "$workdir" 2>/dev/null || true
    }
    trap cleanup_restore_workdir EXIT
    trap 'exit 129' HUP
    trap 'exit 130' INT
    trap 'exit 143' TERM
    aws s3 cp "s3://$S3_BACKUP_BUCKET/$S3_BACKUP_PREFIX/$BACKUP_ARCHIVE" "$workdir/$BACKUP_ARCHIVE"
    aws s3 cp "s3://$S3_BACKUP_BUCKET/$S3_BACKUP_PREFIX/$BACKUP_ARCHIVE.sha256" "$workdir/$BACKUP_ARCHIVE.sha256"
    (cd "$workdir" && shasum -a 256 --check "$BACKUP_ARCHIVE.sha256")
    pg_restore --list "$workdir/$BACKUP_ARCHIVE" >/dev/null
    PGSERVICE=restore-admin psql --no-psqlrc --set=ON_ERROR_STOP=1 --dbname=postgres \
      --command "SELECT 1 FROM pg_database WHERE datname = '$restore_db'"
    PGSERVICE=restore-admin createdb "$restore_db"
    APP_MIGRATOR_PASSWORD="$RESTORE_MIGRATOR_PASSWORD" \
      APP_RUNTIME_PASSWORD="$RESTORE_RUNTIME_PASSWORD" \
      PGSERVICE=restore-admin psql --no-psqlrc --set=ON_ERROR_STOP=1 \
      --dbname="$restore_db" \
      --file /opt/nest-js-starter/config/deployment/postgres/prepare-roles.sql
    PGSERVICE=restore-migrator pg_restore --exit-on-error --no-owner --no-privileges --dbname="$restore_db" "$workdir/$BACKUP_ARCHIVE"
    PGSERVICE=restore-admin psql --no-psqlrc --set=ON_ERROR_STOP=1 \
      --dbname="$restore_db" \
      --file /opt/nest-js-starter/config/deployment/postgres/finalize-roles.sql

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
    cleanup_restore_workdir
    trap - EXIT HUP INT TERM

This recovery reference does not promote an image, run the production migrator,
change a production database, or claim hosted readiness.
