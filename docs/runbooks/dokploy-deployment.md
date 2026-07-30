# Dokploy HTTPS boundary for the deployment operator

The repository-owned CLI implements the Dokploy adapter used by
[deployment.md](deployment.md) and [rollback.md](rollback.md). This document
describes its live inputs and server assumptions; it is not a second manual
implementation.

Authoritative upstream references:

- [Dokploy OpenAPI](https://raw.githubusercontent.com/Dokploy/dokploy/canary/openapi.json)
- [Dokploy deployment schema](https://raw.githubusercontent.com/Dokploy/dokploy/canary/packages/server/src/db/schema/deployment.ts)

Review the current upstream schema before a hosted change window. A locally
passing adapter contract test does not prove that a particular Dokploy instance
is reachable or compatible.

## Readiness prerequisite

Complete [deployment-preparation.md](deployment-preparation.md), approve a
target-owned [release manifest](release-manifest.example.json), and satisfy the
human gates in [deployment.md](deployment.md). Repository readiness and local
CLI tests do not establish environment readiness.

Private authenticated GHCR is the only supported registry mode. The operator
identity must have package read access, and its PAT classic must be limited to
`read:packages` and authorized for organization SSO when required. Do not create
or record that credential before the separately authorized environment window.

## Required live environment

Every apply command reads these protected process environment variables:

| Name                               | Contract                                   |
| ---------------------------------- | ------------------------------------------ |
| `DOKPLOY_BASE_URL`                 | Credential-free HTTPS Dokploy origin       |
| `DOKPLOY_API_KEY`                  | Short-lived application-scoped API key     |
| `DOKPLOY_APPLICATION_ID`           | Existing target application identifier     |
| `DOKPLOY_APPLICATION_ENV`          | Complete candidate runtime environment     |
| `DOKPLOY_PREVIOUS_APPLICATION_ENV` | Complete protected pre-change environment  |
| `GHCR_REGISTRY_URL`                | Exactly `https://ghcr.io`                  |
| `GHCR_USERNAME`                    | Dedicated package-reader identity          |
| `GHCR_PASSWORD`                    | In-memory PAT classic with `read:packages` |
| `MIGRATION_DATABASE_URL`           | Migration-role PostgreSQL connection       |
| `RUNTIME_DATABASE_URL`             | Least-privilege API PostgreSQL connection  |

`DOKPLOY_APPLICATION_ENV` must contain exactly one `DATABASE_URL`, equal
byte-for-byte to `RUNTIME_DATABASE_URL`, and exactly one `SERVICE_REVISION`,
equal to the candidate revision. Values may contain `=`. The CLI splits each
assignment at its first equals sign only.

The variables are accepted from the process environment only. There are no
secret-valued CLI flags. Do not enable shell tracing, print the complete
environments or place credentials in the manifest/evidence files.

## Network boundary

The operator host must reach:

- private GHCR;
- the Dokploy HTTPS API;
- the migration PostgreSQL endpoint;
- the public HTTPS API used by external smoke.

Routine deployment does not require SSH access to the VPS. PostgreSQL and Redis
remain private and must not be exposed publicly to make the operator work. The
long-running API receives only its runtime database role; migration credentials
are passed only to the one-shot candidate container.

Local Alloy, Loki, Tempo and Grafana services belong to the development Compose
profile. They are not production dependencies and do not satisfy hosted
telemetry readiness.

## HTTP and status assumptions

The adapter sends `x-api-key` in memory, uses a bounded request timeout and
expects these contracts:

- `POST /api/application.saveEnvironment` receives the complete environment
  with `buildArgs: null`, `buildSecrets: null`, `createEnvFile: false`;
- `POST /api/application.saveDockerProvider` receives the exact digest, GHCR
  URL and private registry credentials;
- `POST /api/application.deploy` receives the application ID plus exact
  revision-bound title and description;
- `GET /api/deployment.all?applicationId=...` returns an array of records with
  string `deploymentId`, string `status` and optional string `title`.

Mutation responses must be plain empty JSON objects. Transport errors,
non-2xx responses, malformed JSON and unexpected shapes fail closed.

After the deploy request, the operator compares before/after snapshots and
requires exactly one new record with the expected title. It polls only that
record. `running` is the sole non-terminal state; `done` is the sole success.
`error`, `cancelled`, unknown, missing and duplicate states all fail.

## Diagnostics and evidence

Errors expose only the operation, optional HTTP status and fixed failure
category. They exclude API keys, registry passwords, environment values, URLs,
headers and response bodies.

The apply command writes the operator-selected promotion or rollback evidence
file. Keep it with the Stage workflow/revision approval and independently
captured hosted observations. Local mock tests are not hosted evidence, and the
runbook itself is not execution evidence.
