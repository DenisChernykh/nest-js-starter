# Repository instructions

Explain code and Git changes in Russian unless the user requests another
language or a concise answer.

Preserve module-local hexagonal boundaries from
`docs/architecture/module-boundaries.md`. Do not introduce demo CRUD, a generic
repository/controller/service abstraction or a global application Redis
service.

Add or update TSDoc with every hand-written exported TypeScript contract
according to `docs/architecture/tsdoc-guidelines.md`.

Use exact dependencies. Run the narrowest relevant test while working and
`pnpm check:quick` before completing the foundation slice.

Feature branches start from `stage`, merge into `stage` through regular merge
pull requests, and `main` advances from `stage` by fast-forward only. Use
Conventional Commits.
