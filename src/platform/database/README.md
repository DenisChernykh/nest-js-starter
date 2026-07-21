# Database platform

`DatabaseModule` owns exactly one external `pg.Pool`, one Prisma PostgreSQL
adapter and one generated Prisma Client. Construction has no network side
effect; the explicit lifecycle performs bounded startup and cleanup.

Health probes use a dedicated Pool client that can be destroyed on timeout or
abort. Ordinary Prisma operations are admitted through `withClient()` and are
tracked for shutdown, but are not described as cancellable after they start.

Business modules may use the callback-based provider from infrastructure or the
framework-free transaction port introduced by the next slice. Application,
presentation and bootstrap code never import Prisma or `pg` directly.
