# Module boundaries

Each business capability owns one directory under `src/modules/<name>` with
five local layers.

## Allowed directions

- `domain` imports its own domain through relative paths and may import
  `src/shared/domain`; it never imports another module.
- `application` imports its own domain/application and stable shared contracts.
  Runtime application classes may additionally use only `Inject` and
  `Injectable` from `@nestjs/common` as dependency-injection metadata.
  Constructor dependencies remain application ports; application code never
  imports adapter classes.
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

## Platform and shared

`platform` implements technical capabilities and never imports business
modules. `shared/domain` and `shared/application` contain only contracts with at
least two independent consumers; they never import modules or platform code.
Both shared layers remain framework-free.

Nest dependency-injection metadata is a narrow exception for module-local
application classes, not permission to use Nest as an application API.
Application code cannot import HTTP exceptions, `Logger`, `ConfigService`, any
other Nest package, Prisma, Redis, presentation, infrastructure, composition,
platform or bootstrap code.

## Empty layers

A newly generated module may have layer README files before it has real
business behavior. Code appears only when a real use case requires it; the
starter does not generate sample CRUD or marker domain types.
