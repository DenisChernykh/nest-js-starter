# OpenAPI contracts

`docs/api/openapi.json` is the committed wire contract. `openapi:drift`
generates the document in memory and compares bytes; it never writes the
tracked artifact. `openapi:generate` is an explicit authoring command only.
`openapi:lint` validates the committed document.

The contract preserves the eight `/v1/auth` endpoints, cookie security scheme,
RFC 9457 problem responses, protected Swagger mode and health routes. Changes
to endpoint paths, methods, status codes, headers, cookies or problem bodies
require an intentional contract review.
