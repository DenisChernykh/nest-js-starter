# Nest-native application dependency injection

## Context

The starter currently keeps `src/modules/*/application/**` completely free of
NestJS imports. Auth use cases are therefore created through large
`useFactory` provider objects in the composition module.

This preserves theoretical framework independence, but it works against the
primary framework of the starter. Constructor dependencies are duplicated in
manual `inject` arrays and factory parameters, which makes routine use-case
changes harder to review and easier to miswire.

The starter and `backend-codex` will instead use idiomatic NestJS dependency
injection while retaining the important hexagonal boundary: application code
depends on ports, never on concrete adapters.

## Decision

Runtime application classes use `@Injectable()`. Constructor parameters backed
by interface ports use `@Inject(PORT_TOKEN)`.

NestJS composition modules register application classes directly and bind
application-owned tokens to infrastructure adapters with `useExisting`,
`useClass`, or a narrowly scoped adapter factory.

Factories remain appropriate when a provider genuinely constructs
runtime-derived adapter options or conditional infrastructure. They are not
used merely to instantiate use cases.

## Dependency boundary

`src/modules/*/application/**/*.ts` may import only these names from
`@nestjs/common`:

- `Inject`
- `Injectable`

Application code continues to reject:

- `HttpException`, `Logger`, `ConfigService`, controllers, guards, filters and
  other transport/runtime Nest APIs;
- Prisma, Redis, Pino, OpenTelemetry, Express and other infrastructure APIs;
- module-local `infrastructure`, `presentation`, `composition`, `platform` and
  `bootstrap` code;
- concrete adapter classes.

`src/modules/*/domain/**` and `src/shared/application/**` remain completely
framework-free.

## Port tokens and composition

Each interface injected at runtime owns a stable symbol token next to the port
contract. For example:

```ts
/** Injection token for durable auth persistence. */
export const AUTH_PERSISTENCE = Symbol('AUTH_PERSISTENCE')

/** Durable identity operations required by auth use cases. */
export interface AuthPersistencePort {
  // ...
}
```

The use case consumes only that port:

```ts
@Injectable()
export class LoginUseCase {
  public constructor(
    @Inject(AUTH_PERSISTENCE)
    private readonly persistence: AuthPersistencePort,
  ) {}
}
```

The composition module owns the adapter binding:

```ts
providers: [
  PrismaAuthRepository,
  {
    provide: AUTH_PERSISTENCE,
    useExisting: PrismaAuthRepository,
  },
  LoginUseCase,
]
```

Primitive application inputs that must be supplied by composition use explicit
application-owned tokens. Pure unit tests may continue to instantiate use cases
directly without a Nest testing module.

## Enforcement

Dependency Cruiser permits the `@nestjs/common` package from module-local
application code because it cannot inspect imported symbol names.

ESLint provides the precise enforcement:

- `Inject` and `Injectable` are allowed;
- every other import from `@nestjs/common` is rejected;
- all other `@nestjs/**` packages remain rejected;
- existing adapter and infrastructure restrictions remain unchanged.

Architecture fixtures prove both halves of the rule: a use case using
`Injectable`/`Inject` passes, while application code importing `HttpException`,
`Logger`, `ConfigService`, Prisma, Redis or an outer layer fails.

## Scope

The first implementation applies the pattern to the starter auth application
classes and simplifies `AuthModule` provider registration. It updates the
architecture documentation and enforcement used by generated projects.

The same rule is applied to `backend-codex` before its Task 3 migration resumes.
Task 3 may copy the starter implementation, but it must preserve Nest-native
application DI when adapting product modules.

This change does not alter HTTP routes, authentication semantics, database
schema, Redis protocols, error responses or deployment behavior.

## Verification

The change is accepted when:

1. architecture tests demonstrate the allowed and rejected imports;
2. auth application unit tests pass unchanged;
3. a Nest composition test resolves representative auth use cases through
   standard providers;
4. lint, dependency-cruiser, typecheck and focused auth tests pass;
5. `pnpm check:quick` passes;
6. no generic application-provider factory replaces NestJS DI.

## Risks and mitigations

- **Wrong token binding:** composition tests resolve representative use cases
  through the real Nest container.
- **Framework leakage:** ESLint restricts `@nestjs/common` to two DI symbols and
  dependency rules continue to reject every outer layer.
- **Factory removal changes behavior:** existing application tests remain
  unchanged, and provider changes are verified independently from business
  logic.
- **Future projects copy an ambiguous pattern:** architecture documentation,
  fixtures and the auth module all demonstrate the same supported approach.
