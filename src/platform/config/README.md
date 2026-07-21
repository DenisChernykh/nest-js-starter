# Runtime configuration

`RuntimeConfigModule` validates the environment while the Nest composition root
is created. Invalid input stops startup before external resources are opened.

Application code consumes only the typed `environment`, `http` and `database`
groups exposed by `RuntimeConfigService`. Startup logging uses `safeSummary`,
which intentionally omits `DATABASE_URL` and every raw secret value.

`PUBLIC_API_URL` and every CORS entry are exact origins. Paths, credentials,
queries, fragments and wildcard origins are rejected. `TRUST_PROXY_CIDRS` is an
explicit IP/CIDR allowlist; production rejects an empty list and HTTP origins.

Capabilities introduced by later starter slices add configuration keys only
when their behavior is enabled. This slice intentionally has no auth, Redis,
logging, observability or API documentation settings.

`POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_PORT` in
`.env.example` belong only to local Compose. Runtime validation ignores them;
stage and production credentials must use separately managed `DATABASE_URL`
values and must not reuse the example password.
