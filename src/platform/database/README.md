# Database platform

`DatabaseModule` owns exactly one external `pg.Pool`, one Prisma PostgreSQL
adapter and one generated Prisma Client. Construction has no network side
effect; the explicit lifecycle performs bounded startup and cleanup.

Health probes use a dedicated Pool client that can be destroyed on timeout or
abort. Ordinary Prisma operations are admitted through `withClient()` and are
tracked for shutdown, but are not described as cancellable after they start.

Business modules use the callback-based provider only from infrastructure and
the framework-free `TransactionPort` from application. Application,
presentation and bootstrap code never import Prisma or `pg` directly.

An infrastructure adapter must call `withClient()` immediately before every
concrete database operation. The same adapter instance then receives the root
client outside a transaction and the AsyncLocalStorage-scoped client inside it:

```ts
// Correct: admission and transaction scope are resolved for this operation.
return provider.withClient((client) => client.order.findUnique({ where }))

// Incorrect: a cached client can escape a transaction or the closing gate.
this.client = capturedClient
return this.client.order.findUnique({ where })
```

Nested transaction runs join the outer interactive transaction. Any nested
failure marks that context rollback-only, even when the outer callback catches
the original error.

Schema changes are committed under `prisma/migrations` and deployed only by the
explicit `start:migrate` one-shot role. `start:api` opens no migration lock and
performs no schema mutation. Local setup and reset procedures live in
`docs/runbooks/local-postgres.md`.
