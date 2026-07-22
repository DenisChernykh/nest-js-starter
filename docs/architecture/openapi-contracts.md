# OpenAPI contracts

## Ownership and source of truth

The API is code-first, but not inference-first. Controllers and their
request/response DTOs own the contract through explicit `@nestjs/swagger`
decorators. Every operation has a hand-owned stable `operationId`, response
status/media/schema metadata and security declaration. The Nest Swagger CLI
plugin, custom TypeScript transformers and a TypeScript 5 build are forbidden by
the toolchain gate.

`docs/api/openapi.json` is the canonical reviewed OpenAPI 3.0.3 artifact. It is
generated output, not a second source to edit manually. A contract change starts
in controller/DTO metadata, regenerates the artifact and reviews both code and
JSON diff in the same pull request. RFC 9457 public identities additionally come
from `PROBLEM_REGISTRY`; conformance tests keep the registry, DTO enum, Markdown
catalogue and generated components exhaustive.

## Offline generation graph

`openapi:generate` creates `ApiModule` with an immutable dedicated config and
Nest preview mode, applies the same global route metadata as the API process,
builds the document and closes the in-memory application in `finally`. It does
not call `app.init`, `app.listen`, startup registries, Prisma connect or Redis
connect. Deterministic normalization sorts object keys and selected semantic
arrays and writes one terminal newline.

The graph is deliberately the real composition root: health and auth controllers
cannot silently disappear from the artifact. An e2e side-effect test spies on
the HTTP listener, startup registry and both dependency lifecycles. A second test
generates to two private temporary paths and compares their bytes.

## Review gates

The checks have different responsibilities:

1. `openapi:drift` compares fresh offline bytes with the committed artifact.
2. `openapi:lint` applies the pinned Redocly rules.
3. `openapi:operations` rejects missing, duplicate or non-canonical operation
   IDs and incomplete response/security metadata.
4. `openapi:breaking` compares with exactly one explicit Git ref or file. A
   missing source, missing artifact, breaking difference or unclassified
   difference fails the command. There is no fallback to a working-tree or
   self-comparison base.
5. `openapi:client:check` generates a disposable pinned Hey API fetch client,
   compiles a strict TypeScript 7 consumer fixture and proves source files were
   not mutated.
6. `openapi:conformance` validates live success and RFC 9457 responses by
   `operationId`, status and media type against the committed artifact.

`check:quick` owns the offline developer subset. Full `check` adds explicit-base
breaking comparison, client/conformance checks and the real PostgreSQL/Redis
integration, e2e and coverage suites. CI must fetch the target ref and set
`OPENAPI_BREAKING_BASE_REF=origin/stage`. A Git-free release process may instead
set `OPENAPI_BREAKING_BASE_FILE` to a separately obtained reviewed artifact.

## Runtime publication policy

The runtime creates the same document before `app.init`, after request context
and access logging are mounted, and never opens a second listener. Only local
Swagger assets are served. Raw output exists only at `/openapi.json`; YAML and
Nest default alternate JSON paths are disabled.

`API_DOCS_MODE` is a finite deployment policy:

- `off`: no docs routes;
- `public`: unauthenticated routes, rejected in production;
- `protected`: session authentication plus `system.docs.read` for the UI,
  assets and JSON.

Stage explicitly uses `protected`; production normally uses `off`. Denials are
RFC 9457 responses and finite audit events without cookies or secrets. Swagger
sets `withCredentials=true` so the browser sends the opaque HttpOnly session
cookie, sets `persistAuthorization=false`, and has no interceptor capable of
reading cookies. For unsafe operations the user retrieves a session-bound token
from `GET /v1/auth/csrf` and enters only that value in the `csrfToken` header
scheme.

## Consumer pinning

Consumers must pin a reviewed contract identity, never an unqualified live docs
URL. A released consumer pins the backend release/tag or immutable commit and
downloads `docs/api/openapi.json` from that identity. A monorepo or sibling
checkout may pin the exact relative artifact path together with the backend Git
revision. Generated clients are derived artifacts: regenerate them from the
pinned JSON and review the resulting client diff rather than treating their
generator's latest output as authoritative.
