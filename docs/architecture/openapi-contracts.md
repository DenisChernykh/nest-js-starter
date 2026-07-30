# OpenAPI contracts

`docs/api/openapi.json` is the committed wire contract. The API composition
root supplies the complete core-and-module problem catalog to the document
builder. It derives the exact sorted `ProblemResponseDto.code` enum from that
composed catalog, so the schema cannot silently remain core-only when a
maintained business module contributes public errors.

`openapi:drift` generates the complete document in memory and compares bytes; it
never writes the tracked artifact. The authoring flow is explicit: change
presentation DTO/decorator data or a root-selected problem contribution, run
`openapi:generate`, review the resulting wire-contract diff, then run
`openapi:drift` and `openapi:lint`. Runtime startup and drift checks do not
rewrite the committed artifact.

The contract includes the eight `/v1/auth` endpoints, the maintained
`/v1/approval-requests` create/get/decision operations, cookie security scheme,
RFC 9457 problem responses, protected Swagger mode and health routes. Changes
to endpoint paths, methods, status codes, headers, cookies or problem bodies
require an intentional contract review.
