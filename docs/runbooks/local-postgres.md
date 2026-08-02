# Local PostgreSQL runbook

## Prerequisites and startup

Install Node `24.x`, enable pnpm `11.15.1`, and start Docker. The repository
`.nvmrc` selects the supported Node major.

```bash
cp .env.example .env
pnpm install
docker compose up -d --wait postgres
pnpm start:migrate
pnpm dev:api
```

`cp` creates the local runtime/Compose configuration; do not commit `.env`.
The ordinary install reconciles local dependencies; use
`pnpm install --frozen-lockfile` only for an explicit clean or CI gate. Compose
starts only a loopback PostgreSQL service and waits for its healthcheck.
`start:migrate` deploys committed migrations as an explicit one-shot role.
Start the API only after it succeeds.

Verify in another terminal:

```bash
curl --fail-with-body http://localhost:3000/health/live
curl --fail-with-body http://localhost:3000/health/startup
curl --fail-with-body http://localhost:3000/health/ready
```

All three return `200`. Stop the foreground API with `Ctrl-C`, then run:

```bash
docker compose down
```

`down` removes the local container/network but retains the named database
volume. Verify with `docker volume ls` and restart with `docker compose up -d
--wait postgres` when needed.

## Failure branches

- Port conflict: `docker compose ps` and `lsof -nP -iTCP:5432 -sTCP:LISTEN`
  identify the owner. Stop that explicitly known local process or choose another
  `POSTGRES_PORT`; do not kill an unidentified process.
- Docker missing/unavailable: `docker info` must succeed before Compose or
  Docker-backed test commands. Start Docker Desktop and retry.
- Migration failure: do not start/promote the API. Read the Prisma error and
  database logs with `docker compose logs postgres`, correct the forward
  migration or restore a known backup, then rerun `start:migrate`. The API does
  not auto-repair or down-migrate.

## Destructive local reset

> **Warning:** the next command destroys all data in this starter's local
> PostgreSQL named volume. Use it only when no local data must be retained.

```bash
docker compose down -v
```

Precondition: confirm `docker compose ps` names only this starter's resources
and make any required backup. Effect: containers, network and named volume are
removed. Verify with `docker volume ls`. Recovery is only from a prior backup;
otherwise start PostgreSQL again and rerun `start:migrate` to create an empty
schema.

## Git command safety

No Git command is required for this runbook. Before committing configuration or
documentation, use `git status --short` to identify scope, `git diff --check`
to verify whitespace, and `git diff` to review content. These commands are
read-only; accidental staging can be safely undone with
`git restore --staged <explicit-path>` without changing the working file.
