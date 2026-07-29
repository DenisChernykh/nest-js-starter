# Module boundaries

Each business capability owns one directory under `src/modules/<name>` with
five local layers.

## Allowed directions

- `domain` imports its own domain through relative paths and may import
  `src/shared/domain`; it never imports another module.
- `application` imports its own domain/application and stable shared contracts.
- `infrastructure` implements application ports and may use platform adapters.
- `presentation` calls application contracts; it never imports persistence or
  Redis adapters.
- `composition` wires ports and adapters with Nest dependency injection; it
  contains no business policy.
- `bootstrap` imports a module only from its `composition` directory.
- `domain`, `application`, `infrastructure` and `presentation` never import
  `composition`; no module layer imports `bootstrap`.

## Module public API

Code in another business module imports only `@/modules/<name>`, which resolves
to `src/modules/<name>/index.ts`. Internal entities, ports, adapters, DTOs and
composition files are private. Bootstrap is the only layer allowed to import a
module's composition class directly.

Auth is the public presentation integration for authenticated business
controllers. They consume `CurrentPrincipal`, `RequirePermission` and
`AuthenticatedPrincipal` through `@/modules/auth`; they do not import auth
application or presentation internals. Product modules own their permission
keys and expose frozen role contributions from `composition`. The API root
combines those contributions into product-owned role definitions passed to
auth, so auth resolves roles without importing the contributing module.

Each module also owns its public HTTP problem definitions and the mapper from
explicit module error classes. Its composition layer exports that contribution;
the API root installs the selected module contributions in one process catalog.
Neither the global HTTP platform nor another business module recognizes
module-specific errors or codes.

## Platform and shared

`platform` implements technical capabilities and never imports business
modules. `shared/domain` and `shared/application` contain only contracts with at
least two independent consumers; they never import modules or platform code.

## Empty layers

A newly generated module may have layer README files before it has real
business behavior. Code appears only when a real use case requires it; the
starter does not generate sample CRUD or marker domain types.
