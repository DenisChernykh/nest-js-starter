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

## Node and pnpm

- Use the Node major selected by `.nvmrc` (`24`) and the pnpm version declared
  by `packageManager` (`11.15.1`). Confirm `node --version` before commands
  that can change dependencies or generated artifacts.
- Invoke the package manager as plain `pnpm`. Use `pnpm install` for ordinary
  local dependency reconciliation; reserve `pnpm install --frozen-lockfile`
  for an explicit clean or CI reproducibility gate.
- Run dependency-changing commands in a host-capable context with registry
  access and the user-level pnpm store. Do not create or rely on a repo-local
  `.pnpm-store/`.
- Preserve the explicit `allowBuilds` policy in `pnpm-workspace.yaml`; never
  replace it with a global allow-all setting, and update `allowBuilds` in the
  same change when adding a dependency with an install lifecycle script.

Feature branches start from `stage`, merge into `stage` through regular merge
pull requests, and `main` advances from `stage` by fast-forward only. Use
Conventional Commits.
