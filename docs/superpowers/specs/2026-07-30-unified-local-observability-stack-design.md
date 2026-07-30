# Unified local observability stack design

## Status

Approved in discussion on 2026-07-30 for
[`nest-js-starter` issue #26](https://github.com/DenisChernykh/nest-js-starter/issues/26).
The design ports the reusable local runtime topology validated in Amazing EKB
without copying product workers, uploads or schemas.

## Context

The starter already owns two application signals:

- Pino writes structured, redacted JSON logs to stdout.
- OpenTelemetry exports trace-only OTLP protobuf spans for HTTP, PostgreSQL and
  Redis operations.

The current local Compose file starts only PostgreSQL and coordination Redis.
The host API expects an OTLP endpoint on `127.0.0.1:4318`, but the repository
does not provide a receiver, storage or query UI. A developer must start
unrelated tools manually, and an absent collector can produce repeated
sanitized exporter diagnostics.

The current local start is also multi-step: infrastructure, committed
migrations and the watched API are started separately. Once `pnpm dev` becomes
the canonical containerized environment, it must retain the existing invariant
that migrations run as a separate one-shot role before the API starts.

## Goals

1. Make `pnpm dev` the canonical foreground command for the watched API,
   PostgreSQL, Redis, committed migrations and the complete local logs/traces
   stack.
2. Keep TypeScript source edits in the fast path: synchronize source into the
   API container and let Nest watch recompile without rebuilding or restarting
   infrastructure services.
3. Preserve vendor-neutral application boundaries:
   - logs leave the process only through structured stdout;
   - traces leave the process only through OTLP/HTTP;
   - application code imports no Alloy, Loki, Tempo or Grafana clients.
4. Keep observability fail-open: Alloy, Loki, Tempo or Grafana availability
   never becomes an API startup, liveness or readiness dependency.
5. Persist PostgreSQL, Redis, logs, traces and Grafana state across normal
   stop/start operations.
6. Keep every published port loopback-only and every vendor image pinned by
   immutable version and digest.
7. Preserve the local process invariant: migration is an explicit one-shot
   role; the long-running API never applies migrations.

## Non-goals

- No Amazing EKB product workers, imports, uploads or Prisma schema.
- Production and deployment are deferred to a separate task after the local
  logs/traces workflow is complete.
- No metrics exporter, Prometheus, Mimir, dashboards, alerts or profiles.
- No OpenTelemetry log pipeline and no direct Pino network transport.
- No application dependency on observability availability.
- No automatic creation of Prisma migrations.
- No destructive observability-volume reset command.

## Alternatives considered

### Keep host API and add only observability containers

This preserves the current `nest start --watch --no-shell` process on macOS, but Docker
stdout discovery cannot collect its logs. Adding a development log file or
direct network transport would create a second logging path and diverge from
the container runtime boundary.

### Remove the backend migrator and retain manual local migrations

This would make the projects superficially similar, but it would remove the
fail-closed ordering already validated in Amazing EKB. It would also contradict
the one-command `pnpm dev` contract on a new or recreated database.

### Selected: watched API container plus one-shot migrator

The API runs in a non-root development image. Compose Watch synchronizes source
files, the Nest CLI owns recompilation, Docker owns the stdout boundary, and
Alloy collects Docker logs and OTLP traces. A generic one-shot migrator applies
committed migrations after PostgreSQL is healthy and before the API starts.

The migrator depends only on PostgreSQL. Redis and observability services are
not migration dependencies. Amazing EKB product processes and their
configuration are not copied.

## Runtime topology

```text
PostgreSQL healthy
      |
      v
migrator: prisma migrate deploy -- exit 0
      |
      +------------------+
                         v
Redis healthy ------> watched Nest API --------+
      |                                        |
      | structured Pino stdout                 | OTLP/HTTP traces
      v                                        v
Docker logs -- scrape --> Alloy ------------> Alloy
                           |                    |
                           v                    v
                          Loki                Tempo
                           \                    /
                            +----> Grafana <---+
```

The API waits for both successful migration and healthy Redis. Observability
services are foreground peers started by the developer command, not API
dependencies.

## Components and ownership

### Development API image

Add a `development` Dockerfile stage that:

- inherits the repository-pinned Node image and installed dependencies;
- keeps development dependencies required by Nest watch;
- copies repository files with ownership for the existing non-root `node` user;
- creates writable `/app/dist` before changing to the non-root user;
- runs `corepack pnpm@11.15.1 run dev:api`;
- leaves the existing `runtime` stage and compiled entrypoint unchanged.

### One-shot migrator

The local `migrator` service:

- uses the repository image containing Prisma CLI, schema and committed
  migrations;
- runs `corepack pnpm@11.15.1 run start:migrate`;
- waits only for healthy PostgreSQL;
- uses `restart: "no"`;
- must exit successfully before the API starts.

It does not generate migrations, seed data, create an administrator, connect to
Redis or depend on observability. Failure prevents API startup and remains
visible in Compose output.

The API owns the separate healthy Redis dependency. Redis is therefore included
in the one-command environment without being coupled to schema migration.

### Compose Watch

Only the locally built API service receives `develop.watch` rules:

- `src/**` uses `sync` with `initial_sync: true`;
- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `prisma/**` and
  `prisma.config.ts` use `rebuild`;
- Nest and TypeScript configuration files use `sync+restart`.

Host `node_modules`, `dist`, Git state and environment files are not
synchronized. Source changes must not recreate PostgreSQL, Redis, Alloy, Loki,
Tempo or Grafana.

`initial_sync` requires Docker Compose `v2.39.4` or newer. CI pins that minimum
version so the lower compatibility boundary stays executable; the local
Docker Desktop version may be newer.

### Grafana Alloy

Alloy is the single local ingestion boundary:

- `loki.source.docker` discovers only the API container from the current
  Compose project;
- the Docker envelope and Pino JSON record are parsed;
- only low-cardinality fields such as service, environment, level and Compose
  service become Loki labels;
- `traceId`, `spanId`, request ID, event, module and reason code remain
  structured metadata or log content;
- an OTLP/HTTP receiver listens on container port `4318`;
- a bounded batch processor forwards traces to Tempo.

Alloy mounts the Docker socket read-only for discovery inside this local
Compose project. The mount is not generalized beyond that boundary.

### Loki

Loki runs in local single-binary mode with filesystem-backed storage in a named
volume and seven-day retention. It has no published host port; Alloy ingests
logs and Grafana queries them over the Compose network.

### Tempo

Tempo `2.10.7` runs in monolithic local mode with filesystem-backed WAL and
blocks in a named volume and seven-day retention. It has no published host
port. Alloy sends OTLP/HTTP traces over the Compose network.

Tempo `3.0.2` is not used in this slice because the validated single-binary
topology repeatedly reports an idle backend scheduler condition as an error.

### Grafana

Grafana is the only browser UI and publishes its port on `127.0.0.1`.
Provisioning mounts only the datasource directory and creates:

- a Loki datasource;
- a Tempo datasource;
- a Loki derived field from structured `traceId` to Tempo;
- Tempo trace-to-logs navigation using service identity and trace ID.

Provisioning expressions such as `${__value.raw}`,
`${__resource.service.name}` and `${__span.traceId}` are escaped as
`$${...}` so Compose preserves the literal Grafana expressions.

Anonymous Editor access is acceptable only behind this loopback-only local
binding.

## Command contract

- `pnpm dev`: starts the development and observability profiles in foreground
  Watch mode. Named API, Alloy, Loki, Tempo and Grafana services pull in
  PostgreSQL, Redis and the one-shot migrator through explicit dependencies.
- `pnpm dev:api`: internal Nest CLI watch command used by the development
  image. It generates Prisma Client and runs `nest start --watch --no-shell` so
  Nest CLI owns the actual API child process across recompilations.
- `pnpm dev:host`: limited macOS debugging escape hatch. It runs `dev:api` with
  `OTEL_SDK_DISABLED=true`, writes logs only to the terminal and expects
  PostgreSQL/Redis plus committed migrations to be prepared separately.
- `pnpm dev:down`: stops the exact API, migrator, PostgreSQL, Redis, Alloy, Loki,
  Tempo and Grafana services without removing named volumes.

`Ctrl+C` may leave dependency services running because they are not foreground
targets. Documentation names `pnpm dev:down` as the complete shutdown command.

## Ports and persistence

Published ports bind to `127.0.0.1` only:

- API: `3000` by default;
- Grafana: `3004` by default;
- Alloy OTLP/HTTP: `4318` by default;
- PostgreSQL and Redis retain their existing loopback-only development ports.

Loki, Tempo and Alloy management ports remain internal.

Dedicated named volumes preserve:

- PostgreSQL data;
- Redis data;
- Loki chunks and index;
- Tempo WAL and blocks;
- Grafana state.

Ordinary `pnpm dev:down`, restart and container recreation do not delete these
volumes.

## Failure behavior

- Migrator failure prevents API startup.
- Alloy failure does not change API liveness or readiness.
- Loki failure may produce Alloy infrastructure diagnostics, but Pino continues
  writing to stdout and request handling does not block.
- Tempo failure may drop traces after bounded buffering, but API requests
  continue.
- Grafana failure affects only querying; ingestion and storage continue.
- Source synchronization failure is reported by Compose Watch and does not
  recreate unrelated infrastructure services.
- The existing sanitized `otel_diagnostic` event remains the application-side
  collector outage signal.

## Testing strategy

### Configuration tests

Resolve the real model with `docker compose config --format json` and verify:

- API, migrator, Alloy, Loki, Tempo and Grafana services exist;
- the API uses the development target and internal Alloy endpoint;
- the migrator waits only for PostgreSQL and the API waits for both successful
  migration and healthy Redis;
- observability is absent from API `depends_on`;
- Watch sync, rebuild and restart rules target the expected paths;
- vendor images are versioned and digest-pinned;
- published ports are loopback-only;
- Docker socket and provisioning mounts are read-only;
- observability volumes exist;
- scripts preserve volumes and name exact services.

The tests inspect resolved Compose JSON instead of grepping YAML.

### Vendor configuration validation

Validate Alloy, Loki and Tempo configuration with their pinned images or native
validation/startup boundaries. Verify the committed Grafana datasource YAML
preserves literal escaped correlation expressions after Compose resolution.

### Runtime smoke

Use an isolated Compose project and test-owned volumes:

1. start the selected services and poll readiness without fixed sleeps;
2. confirm the migrator exits successfully before the API becomes ready;
3. edit a synchronized source fixture and observe Nest recompilation without
   infrastructure container recreation;
4. stop Alloy and confirm API liveness/readiness remain healthy;
5. send a request and query its structured log from Loki;
6. query the corresponding trace from Tempo;
7. prove the shared trace ID supports Grafana correlation;
8. restart Loki, Tempo and Grafana and confirm retained data remains queryable;
9. verify no secret fixture appears in stored logs or traces;
10. remove only the isolated test project and its test-owned volumes.

### Repository gate

Run the narrowest relevant tests during implementation, then run
`pnpm check:quick`. Docker configuration and runtime checks remain explicit
additional evidence because `check:quick` does not prove a running local stack.

## Acceptance criteria

- `pnpm dev` starts PostgreSQL, Redis, migrator, watched API, Alloy, Loki, Tempo
  and Grafana.
- A new database receives committed migrations before API startup.
- Source edits trigger Nest recompilation without rebuilding infrastructure.
- API liveness and readiness remain healthy while Alloy is stopped.
- A request log is queryable in Loki and its trace is queryable in Tempo.
- Grafana navigation preserves literal provisioning expressions and correlates
  logs/traces by service and trace ID.
- Logs, traces and Grafana state survive ordinary stop/start and service
  restart.
- Ports are loopback-only and vendor images use immutable pins.
- Vendor configuration and resolved Compose contracts have automated tests.
- Documentation explains commands, restart rules, retention and failures.
- No Amazing EKB product worker, upload boundary or product schema enters the
  starter.
