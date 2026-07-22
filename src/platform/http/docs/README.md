# API documentation adapter

Responsibility: explicit Swagger presentation metadata, the shared OpenAPI
document factory and canonical JSON normalization.

Allowed dependencies: presentation metadata and auth public contracts only.

Offline generation composes the real `ApiModule` graph without opening a
listener or starting PostgreSQL/Redis. Runtime documentation reuses the same
document factory; neither path maintains a second endpoint-schema copy.
