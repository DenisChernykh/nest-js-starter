# Migrator bootstrap

Responsibility: future one-shot Prisma migration process.

Allowed dependencies: composition and platform lifecycle only.

Add the first TypeScript file only when the owning slice introduces a real
runtime contract; do not add sample business behavior to populate the folder.
