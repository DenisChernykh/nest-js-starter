# Runtime configuration

`createApiRuntimeConfig()` validates and normalizes the API process environment
before Nest is created or external resources are opened. `RuntimeConfigModule`
binds that complete prevalidated immutable configuration.

Composition code consumes the typed `environment`, `logging`, `observability`,
`docs`, `http`, `database`, `redis` and `auth` groups exposed by
`RuntimeConfigService`. `safeSummary` is an available non-secret diagnostic
projection; the current API bootstrap does not emit it.

`PUBLIC_API_URL` and every CORS entry are exact origins. Paths, credentials,
queries, fragments and wildcard origins are rejected. `TRUST_PROXY_CIDRS` is an
explicit IP/CIDR allowlist; production rejects an empty list and HTTP origins.

Standalone PostgreSQL commands, queue workers and the outbox relay use narrower
process-specific configuration projections.

`POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_PORT` in
`.env.example` belong only to local Compose. Runtime validation ignores them;
stage and production credentials must use separately managed `DATABASE_URL`
values and must not reuse the example password.
