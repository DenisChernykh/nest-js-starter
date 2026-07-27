# PostgreSQL backup and isolated restore

## Backup policy

The environment-owned backup job runs daily at **02:15 UTC** and retains the
newest **14 complete off-host S3 copies**. A copy is a custom-format pg_dump
archive plus its SHA-256 sidecar under a dedicated, non-shared S3 prefix. The
backup identity is the UTC timestamp in YYYYMMDDTHHMMSSZ form.

Configure the scheduler itself with UTC explicitly (for example, an
environment-owned cron entry CRON_TZ=UTC and 15 2 * * *). It must run one backup
at a time, alert on any non-zero step, and delete only the archive and sidecar
pairs belonging to backup IDs older than the 14 newest successful IDs in this
dedicated prefix. Do not use a broad recursive delete, a shared bucket prefix,
or a time-only lifecycle rule that can split an archive from its sidecar. After
cleanup, list the dedicated prefix and prove there are exactly 14
archive/sidecar pairs; this is the retention evidence.

S3 credentials, bucket policy, endpoint, and PostgreSQL connection settings
are environment secrets. They are not committed or printed. The S3 principal
may write and read only this backup prefix. Its delete permission must be
limited to the exact archive and sidecar keys for the current in-flight
`backup_id` when publication aborts, plus explicitly identified expired final
pairs; it must not receive a recursive delete permission. The scheduler must
alert if either exact-key cleanup operation is denied, because a partial object
would otherwise remain for operator cleanup. The principal must not receive
application or database administration privileges.

## Scheduled backup operation

The scheduler injects `MIGRATION_DATABASE_URL`, `S3_BACKUP_BUCKET`, and
`S3_BACKUP_PREFIX` without a trailing slash. The protected `backup-source`
service entry is a local alias for `MIGRATION_DATABASE_URL`, unless the
environment deliberately supplies a separate read-only backup login; do not
introduce another public connection variable. Neither connection value is
echoed. Run the following operation exactly as the scheduler account:

```bash
set -eu
set +x
: "$S3_BACKUP_BUCKET"
: "$S3_BACKUP_PREFIX"

backup_id="$(date -u +%Y%m%dT%H%M%SZ)"
workdir="$(mktemp -d "${TMPDIR:-/tmp}/nest-js-starter-pg-backup.XXXXXX")"
archive_name="nest-js-starter-$backup_id.dump"
backup_published=0
cleanup_backup() {
  status=$?
  cleanup_failed=0
  if [ "$status" -ne 0 ] && [ "$backup_published" -eq 0 ]; then
    if ! aws s3 rm --only-show-errors \
      "s3://$S3_BACKUP_BUCKET/$S3_BACKUP_PREFIX/$archive_name"; then
      printf '%s\n' 'failed to remove incomplete backup archive; investigate immediately' >&2
      cleanup_failed=1
    fi
    if ! aws s3 rm --only-show-errors \
      "s3://$S3_BACKUP_BUCKET/$S3_BACKUP_PREFIX/$archive_name.sha256"; then
      printf '%s\n' 'failed to remove incomplete backup sidecar; investigate immediately' >&2
      cleanup_failed=1
    fi
    if [ "$cleanup_failed" -ne 0 ]; then
      printf '%s\n' 'backup cleanup was not fully verified; do not count this backup as published' >&2
    fi
  fi
  rm -rf "$workdir"
  trap - EXIT HUP INT TERM
  exit "$status"
}
trap cleanup_backup EXIT HUP INT TERM

PGSERVICE=backup-source pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file "$workdir/$archive_name"

(
  cd "$workdir"
  shasum -a 256 "$archive_name" | awk '{print $1 "  " $2}' >"$archive_name.sha256"
  pg_restore --list "$archive_name" >/dev/null
)

aws s3 cp --only-show-errors \
  "$workdir/$archive_name" \
  "s3://$S3_BACKUP_BUCKET/$S3_BACKUP_PREFIX/$archive_name"
aws s3 cp --only-show-errors \
  "$workdir/$archive_name.sha256" \
  "s3://$S3_BACKUP_BUCKET/$S3_BACKUP_PREFIX/$archive_name.sha256"
backup_published=1

printf '%s\n' "backup $backup_id uploaded with SHA-256 sidecar"
```

The sidecar is integrity metadata for a file-level end-to-end check; the local
pg_restore --list also proves that the custom archive is readable before upload.
After upload, the scheduler must run a remote download/checksum sample as part
of its periodic restore drill, not rely on an S3 ETag as a checksum.

## Restore drill — new database only

Run at least quarterly and after material database-platform changes. The drill
uses the latest complete pair, never clears or replaces the source database,
and starts an internal-only API against the restored database. The
`restore-*` connection entries and `RESTORE_*` environment values below are
deliberately local aliases for the isolated target; they are supplied by the
secret manager and are distinct from the canonical `MIGRATION_DATABASE_URL`,
`RUNTIME_DATABASE_URL`, and `PUBLIC_API_URL` inputs used by promotion.

```bash
set -eu
set +x
: "$S3_BACKUP_BUCKET"
: "$S3_BACKUP_PREFIX"
: "$BACKUP_ID"

restore_run_id="$(date -u +%Y%m%dT%H%M%SZ)"
restore_db="nest_js_starter_restore_$restore_run_id"
workdir="$(mktemp -d "${TMPDIR:-/tmp}/nest-js-starter-pg-restore.XXXXXX")"
archive_name="nest-js-starter-$BACKUP_ID.dump"
restore_api_pid=''
cleanup_restore() {
  status=$?
  if [ -n "$restore_api_pid" ]; then
    kill "$restore_api_pid" 2>/dev/null || true
    wait "$restore_api_pid" 2>/dev/null || true
  fi
  if [ "$status" -eq 0 ]; then
    rm -rf "$workdir"
  else
    printf '%s\n' \
      "restore failed; retain the private diagnostic log at $workdir/restore-api.log" \
      >&2
  fi
  trap - EXIT HUP INT TERM
  exit "$status"
}
trap cleanup_restore EXIT HUP INT TERM

source_db="$(PGSERVICE=backup-source psql --no-psqlrc --tuples-only --no-align \
  --command 'SELECT current_database()')"
[ "$restore_db" != "$source_db" ] || {
  printf '%s\n' 'refusing restore: generated target equals source database' >&2
  exit 64
}

source_metadata="$(PGSERVICE=backup-source psql --no-psqlrc --tuples-only --no-align \
  --command "SELECT json_build_object('encoding', pg_encoding_to_char(datencoding), 'locale_provider', CASE datlocprovider WHEN 'c' THEN 'libc' WHEN 'i' THEN 'icu' WHEN 'b' THEN 'builtin' ELSE 'unknown' END, 'lc_collate', datcollate, 'lc_ctype', datctype, 'locale', coalesce(datlocale, ''), 'icu_rules', coalesce(daticurules, '')) FROM pg_database WHERE datname = current_database()")"
source_encoding="$(printf '%s' "$source_metadata" | jq -er '.encoding | select(type == "string" and length > 0)')"
source_locale_provider="$(printf '%s' "$source_metadata" | jq -er '.locale_provider | select(type == "string" and length > 0)')"
source_lc_collate="$(printf '%s' "$source_metadata" | jq -er '.lc_collate | select(type == "string" and length > 0)')"
source_lc_ctype="$(printf '%s' "$source_metadata" | jq -er '.lc_ctype | select(type == "string" and length > 0)')"
source_locale="$(printf '%s' "$source_metadata" | jq -er '.locale')"
source_icu_rules="$(printf '%s' "$source_metadata" | jq -er '.icu_rules')"
test -n "$source_encoding" && test -n "$source_locale_provider" || {
  printf '%s\n' 'refusing restore: source database locale metadata is unavailable' >&2
  exit 64
}

aws s3 cp --only-show-errors \
  "s3://$S3_BACKUP_BUCKET/$S3_BACKUP_PREFIX/$archive_name" \
  "$workdir/$archive_name"
aws s3 cp --only-show-errors \
  "s3://$S3_BACKUP_BUCKET/$S3_BACKUP_PREFIX/$archive_name.sha256" \
  "$workdir/$archive_name.sha256"
(
  cd "$workdir"
  shasum -a 256 -c "$archive_name.sha256"
  pg_restore --list "$archive_name" >/dev/null
)

PGSERVICE=restore-admin psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --set=restore_db="$restore_db" <<'SQL'
SELECT format($guard$
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_database WHERE datname = %L) THEN
    RAISE EXCEPTION 'restore target already exists';
  END IF;
END
$$;
$guard$, :'restore_db') \gexec
SQL

case "$source_locale_provider" in
  libc)
    PGSERVICE=restore-admin psql --no-psqlrc --set=ON_ERROR_STOP=1 \
      --set=restore_db="$restore_db" \
      --set=source_encoding="$source_encoding" \
      --set=source_lc_collate="$source_lc_collate" \
      --set=source_lc_ctype="$source_lc_ctype" <<'SQL'
SELECT format(
  'CREATE DATABASE %I TEMPLATE template0 ENCODING %L LOCALE_PROVIDER libc LC_COLLATE %L LC_CTYPE %L',
  :'restore_db', :'source_encoding', :'source_lc_collate', :'source_lc_ctype'
) \gexec
SQL
    ;;
  icu)
    test -n "$source_locale" || {
      printf '%s\n' 'refusing restore: ICU locale is unavailable' >&2
      exit 64
    }
    if [ -n "$source_icu_rules" ]; then
      PGSERVICE=restore-admin psql --no-psqlrc --set=ON_ERROR_STOP=1 \
        --set=restore_db="$restore_db" \
        --set=source_encoding="$source_encoding" \
        --set=source_locale="$source_locale" \
        --set=source_icu_rules="$source_icu_rules" <<'SQL'
SELECT format(
  'CREATE DATABASE %I TEMPLATE template0 ENCODING %L LOCALE_PROVIDER icu ICU_LOCALE %L ICU_RULES %L',
  :'restore_db', :'source_encoding', :'source_locale', :'source_icu_rules'
) \gexec
SQL
    else
      PGSERVICE=restore-admin psql --no-psqlrc --set=ON_ERROR_STOP=1 \
        --set=restore_db="$restore_db" \
        --set=source_encoding="$source_encoding" \
        --set=source_locale="$source_locale" <<'SQL'
SELECT format(
  'CREATE DATABASE %I TEMPLATE template0 ENCODING %L LOCALE_PROVIDER icu ICU_LOCALE %L',
  :'restore_db', :'source_encoding', :'source_locale'
) \gexec
SQL
    fi
    ;;
  builtin)
    test -n "$source_locale" || {
      printf '%s\n' 'refusing restore: builtin locale is unavailable' >&2
      exit 64
    }
    PGSERVICE=restore-admin psql --no-psqlrc --set=ON_ERROR_STOP=1 \
      --set=restore_db="$restore_db" \
      --set=source_encoding="$source_encoding" \
      --set=source_locale="$source_locale" <<'SQL'
SELECT format(
  'CREATE DATABASE %I TEMPLATE template0 ENCODING %L LOCALE_PROVIDER builtin BUILTIN_LOCALE %L',
  :'restore_db', :'source_encoding', :'source_locale'
) \gexec
SQL
    ;;
  *)
    printf '%s\n' 'refusing restore: unsupported source locale provider' >&2
    exit 64
    ;;
esac

# Prepare the new target only. The source connection is never used below.
PGSERVICE=restore-admin psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --dbname="$restore_db" <<'SQL'
SELECT format('GRANT CONNECT ON DATABASE %I TO app_migrator, app_runtime', current_database()) \gexec
SELECT format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database()) \gexec
SELECT format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM app_runtime', current_database()) \gexec
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO app_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO app_migrator;
GRANT USAGE ON SCHEMA public TO app_runtime;
REVOKE CREATE ON SCHEMA public FROM app_runtime;
SQL

# Objects restore under app_migrator so the verification uses the same
# ownership boundary as a promoted database.
PGSERVICE=restore-migrator pg_restore \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  --dbname="$restore_db" \
  "$workdir/$archive_name"

# Reassert the target boundary after restore. PostgreSQL's built-in public
# schema may otherwise remain owned by pg_database_owner.
PGSERVICE=restore-admin psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --dbname="$restore_db" <<'SQL'
ALTER SCHEMA public OWNER TO app_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO app_migrator;
GRANT USAGE ON SCHEMA public TO app_runtime;
REVOKE CREATE ON SCHEMA public FROM app_runtime;
SQL

PGSERVICE=restore-admin psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --dbname="$restore_db" <<'SQL'
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
REVOKE ALL ON TABLE public._prisma_migrations FROM app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_runtime;
SQL
```

The generated restore_db name has a UTC suffix. The guard raises a PostgreSQL
exception for an existing target, so `ON_ERROR_STOP` returns non-zero and the
`CREATE DATABASE`/restore commands do not run. Never substitute the source
database name, add --clean, or run pg_restore with a source service entry.
--clean is intentionally absent because the restore target is newly created.

## Representative verification

The following checks deliberately return aggregate state only: migration
history, the auth singleton's invariant, and a runtime DDL-denial probe. They
do not print application rows or credentials.

```bash
set -eu
set +x

PGSERVICE=restore-verifier psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --dbname="$restore_db" <<'SQL'
SELECT count(*) AS applied_migrations
FROM public._prisma_migrations
WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;

SELECT count(*) = 1 AS auth_singleton_present
FROM public.auth_security_state
WHERE id = 1;
SQL

if PGSERVICE=restore-runtime psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --dbname="$restore_db" \
  --command 'CREATE TABLE public.restore_runtime_ddl_probe (id integer)' \
  >/dev/null 2>&1; then
  printf '%s\n' 'unexpected: runtime role created a table' >&2
  exit 1
fi
printf '%s\n' 'runtime DDL denial verified'
```

Start an API only on loopback and only with restored runtime credentials. The
supplied RESTORE_* values are secret-injected and never printed; the Redis key
prefix is unique to this drill so it cannot share sessions, limits, or
coordination state with the source environment.

```bash
set -eu
set +x
: "$RESTORE_RUNTIME_DATABASE_URL"
: "$RESTORE_REDIS_COORDINATION_URL"
: "$RESTORE_AUTH_SESSION_KEY_SECRET"
: "$RESTORE_AUTH_CSRF_SECRET"
: "$RESTORE_AUTH_RATE_LIMIT_KEY_SECRET"
: "$RESTORE_AUTH_NETWORK_METADATA_SECRET"

restore_port=3101
restore_prefix="restore-$(printf '%s' "$BACKUP_ID-$restore_run_id" | tr '[:upper:]' '[:lower:]')"
if lsof -nP -iTCP:"$restore_port" -sTCP:LISTEN >/dev/null 2>&1; then
  printf '%s\n' "refusing restore API: loopback port $restore_port is in use" >&2
  exit 64
fi

# The API is loopback-only for this isolated drill. Development mode is
# required because production configuration rejects HTTP origins.
export NODE_ENV=development
export API_HOST=127.0.0.1
export API_PORT="$restore_port"
export API_DOCS_MODE=off
export PUBLIC_API_URL="http://127.0.0.1:$restore_port"
export CORS_ORIGINS="http://127.0.0.1:$restore_port"
export TRUST_PROXY_CIDRS=127.0.0.1/32
export OTEL_SDK_DISABLED=true
export SERVICE_VERSION=restore-drill
export SERVICE_REVISION="$restore_run_id"
export DATABASE_URL="$RESTORE_RUNTIME_DATABASE_URL"
export REDIS_COORDINATION_URL="$RESTORE_REDIS_COORDINATION_URL"
export REDIS_KEY_PREFIX="$restore_prefix"
export AUTH_SESSION_KEY_SECRET="$RESTORE_AUTH_SESSION_KEY_SECRET"
export AUTH_CSRF_SECRET="$RESTORE_AUTH_CSRF_SECRET"
export AUTH_RATE_LIMIT_KEY_SECRET="$RESTORE_AUTH_RATE_LIMIT_KEY_SECRET"
export AUTH_NETWORK_METADATA_SECRET="$RESTORE_AUTH_NETWORK_METADATA_SECRET"
corepack pnpm@11.15.1 start:api >"$workdir/restore-api.log" 2>&1 &
restore_api_pid=$!

for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error --connect-timeout 2 --max-time 5 \
    --output /dev/null \
    "http://127.0.0.1:$restore_port/health/ready"; then
    printf '%s\n' 'isolated restore API is ready'
    break
  fi
  [ "$attempt" -lt 30 ] || {
    printf '%s\n' 'restore API did not become ready; inspect the private temporary log' >&2
    exit 1
  }
  sleep 1
done

kill "$restore_api_pid"
wait "$restore_api_pid" || true
restore_api_pid=''
```

Record the selected backup ID, SHA-256 verification result, restore target
name, migration count, singleton result, DDL denial, and loopback readiness in
the environment-owned drill record. Delete the separately restored database
only under its explicit UTC-suffixed name and only after that record is
accepted; deletion is outside this runbook. The source database is never
cleared, replaced, or restored over.

On a failed drill the work directory is intentionally retained with mode 0700
so the startup log remains available for redacted incident evidence. After the
evidence is accepted, remove only that generated work directory and its
separately restored database; never delete the source database or a shared
temporary directory.
