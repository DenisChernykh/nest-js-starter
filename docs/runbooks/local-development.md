# Local development

## Happy path

Use the repository-pinned Node.js `24.18.0`, pnpm `11.15.1` and Docker Compose
`2.39.4` or newer:

```sh
node --version
pnpm --version
docker compose version
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

`pnpm dev` stays in the foreground and starts PostgreSQL, auth Redis,
the one-shot migrator, the watched Nest API, Alloy, Loki, Tempo and Grafana.

Verify:

- API readiness: <http://127.0.0.1:3000/health/ready>
- Grafana Explore: <http://127.0.0.1:3004/explore>

Stop the workflow with `pnpm dev:down`.

## Actual process and persistence boundary

PostgreSQL becomes healthy first. The separate `migrator` container runs
`pnpm start:migrate` against committed Prisma migrations and exits. The API
starts only after that successful exit and healthy Redis. The long-running API
process never applies migrations. Inside the API container, the internal
`pnpm dev:api` command generates Prisma Client and starts Nest CLI watch; it is
not the public workflow command. Nest runs the API child without an
intermediate shell so recompilation can terminate the previous listener before
starting the next one.

The API writes Pino JSON to stdout. Docker owns those logs, Alloy reads the API
container through the Docker socket and forwards records to Loki. The API sends
trace-only OTLP/HTTP to Alloy on the Compose network. Alloy also publishes its
OTLP/HTTP receiver on `127.0.0.1:4318` for local host tools, then forwards spans
to Tempo. Grafana queries Loki and Tempo over the Compose network.

PostgreSQL, Redis, Loki, Tempo and Grafana use named volumes. Ordinary stop and
start operations preserve them.

## Grafana Explore

Open <http://127.0.0.1:3004/explore>. The provisioned datasource UIDs are:

- `loki` for structured API logs;
- `tempo` for traces.

Loki log records containing a 32-character hexadecimal `traceId` link to the
matching Tempo trace. Tempo trace-to-logs navigation filters Loki by service
and trace ID. Only `service`, `environment` and `level` are Loki labels;
request, trace and span IDs remain metadata or content.

## Change and restart matrix

| Change                          | Action                                                           |
| ------------------------------- | ---------------------------------------------------------------- |
| `src/**`                        | Compose sync; Nest recompiles inside existing API container      |
| package/lock/workspace manifest | rebuild and recreate only API                                    |
| Prisma schema/config            | rebuild API; restart full workflow to rerun committed migrations |
| Nest/TypeScript config          | sync and restart only API container                              |
| `.env`                          | `pnpm dev:down`, then `pnpm dev`                                 |
| observability config            | restart the affected vendor service                              |
| ordinary stop/start             | named-volume data remains                                        |

## Host debugging escape hatch

Host mode intentionally disables OpenTelemetry export and does not provide
centralized Docker logs or Grafana correlation. Prepare infrastructure and
migrations, then run the Nest watcher on the host:

```sh
docker compose up -d --wait postgres redis-auth
pnpm start:migrate
pnpm dev:host
```

## Complete shutdown

Run:

```sh
pnpm dev:down
```

This stops the API, migrator, Alloy, Loki, Tempo, Grafana, PostgreSQL and Redis
containers named by the local workflow. It does not remove named volumes.
Deleting local data is a separate destructive Compose operation and is
deliberately not provided as a package script.

## Collector/storage/UI failures

Alloy, Loki, Tempo and Grafana are not API dependencies:

- Alloy loss stops new centralized logs and traces while API readiness remains
  healthy.
- Loki loss makes new centralized logs unavailable and causes Alloy delivery
  errors; it does not stop the API.
- Tempo loss makes new traces unavailable and causes Alloy delivery errors; it
  does not stop the API.
- Grafana loss removes only the local query UI; ingestion services continue.

Restart the affected service with
`docker compose --profile observability start <service>`. New telemetry resumes
after its ingestion path is healthy; missed telemetry is not guaranteed to be
replayed.

## Occupied ports and Docker socket

All published ports bind to `127.0.0.1`. Override `API_PORT`, `GRAFANA_PORT`,
`OTLP_HTTP_PORT`, `POSTGRES_PORT` or `REDIS_PORT` in `.env` when a local port is
occupied, then restart the workflow.

Alloy mounts `/var/run/docker.sock` read-only and filters discovery to the
current Compose project and its `api` service. Read-only Docker API access is
still privileged; do not broaden the mount or service allowlist.

## Local data retention

Loki logs and Tempo traces have `168h` retention. Named volumes persist across
`pnpm dev:down` and ordinary Docker restarts. Grafana state, PostgreSQL data and
Redis data persist until their named volumes are explicitly removed.
