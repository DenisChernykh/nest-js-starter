# Module boundaries

Each business context owns one directory under `src/modules/<name>`. A simple
context may place its five local layers directly below that root. A composite
context uses feature-first capability directories, and the same layer rules
apply recursively inside every capability.

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

`identity-access` is the public integration for authenticated business
controllers. Its root `index.ts` exports exactly `CurrentPrincipal`,
`RequirePermission` and `AuthenticatedPrincipal`. Other business modules import
those contracts only through `@/modules/identity-access`; ports, adapters,
controllers and composition files remain private. Product modules own their
permission keys and expose frozen role contributions from `composition`. The
API root combines those contributions into product-owned role definitions, so
identity-access resolves roles without importing the contributing module.

## Identity-access internal capabilities

`src/modules/identity-access` is a composite context with these allowed
capability dependencies:

```text
SessionsModule -> IdentityModule
AuthenticationModule -> SessionsModule
AuthorizationModule -> SessionsModule
AccountLifecycleModule -> AuthenticationModule, SessionsModule, AuthorizationModule
AccountAdministrationModule -> SessionsModule, AuthorizationModule
IdentityAccessModule -> all capability modules
```

An arrow means that the left capability imports only the right capability's
public internal exports. Reverse edges, bare composition-module imports and
deep imports into another capability are forbidden. Platform dependencies such
as PostgreSQL, Redis, runtime configuration and logging are wired by the owning
capability composition and do not change this business DAG.

`IdentityAccessModule.forRoot()` creates one configured
`AuthorizationModule.forRoot(roleDefinitions)`. The exact same dynamic module
is passed to account lifecycle and account administration; neither capability
constructs a second role registry or imports a bare `AuthorizationModule`.
Only `IdentityAccessModule` registers the ordered global security chain.

Authentication providers do not receive Redis/session infrastructure or
principal security fields. A provider verifies its proof, safely resolves or
explicitly links a stable `userId`, then calls `SessionIssuer` with only
`userId`, time and bounded device/network metadata. `SessionIssuer` reloads
the authoritative identity security state, session generation and global epoch
before issuing a session. Automatic linking by matching email is forbidden.

Each module also owns its public HTTP problem definitions and the mapper from
explicit module error classes. Its composition layer exports that contribution;
the API root installs the selected module contributions in one process catalog.
Neither the global HTTP platform nor another business module recognizes
module-specific errors or codes.

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
