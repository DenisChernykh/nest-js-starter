# Migrator bootstrap

The supported one-shot migration entrypoint is the official
`prisma migrate deploy --config prisma.config.ts`, exposed as `start:migrate`.
There is deliberately no TypeScript wrapper: it would add no lifecycle contract
and could incorrectly couple schema deployment to the long-running API.

The API never invokes migrations. An operator or deployment platform runs the
migrator job before starting or promoting API instances. Down migrations are
not automatic; recovery uses a reviewed forward migration or an explicit
database restore procedure.
