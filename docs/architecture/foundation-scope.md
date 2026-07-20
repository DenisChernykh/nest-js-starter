# Foundation scope

The foundation slice proves repository portability, compiler/tooling
reproducibility and dependency boundaries. `ApiModule` is compile-only.

The next slice owns the first executable API/migrator bootstraps, typed runtime
configuration, PostgreSQL/Prisma, health routes and graceful shutdown.
