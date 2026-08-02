# Nest-native application DI implementation plan

> **For Codex:** Execute this plan one task at a time with `superpowers:executing-plans`. Use TDD for every behavior or architecture-policy change. Do not push, open a PR, or deploy.

**Goal:** Make the starter use idiomatic Nest dependency injection for runtime application classes while keeping module-local hexagonal boundaries enforceable.

**Architecture:** Runtime classes under `src/modules/*/application` may use only `Inject` and `Injectable` from `@nestjs/common`. Interfaces remain the application contracts; symbols declared next to those ports are the runtime DI tokens. Composition binds adapter classes to the port tokens with `useExisting`, registers application classes directly, and retains factories only where adapter construction depends on runtime configuration. Domain and `src/shared/application` remain entirely framework-free.

**Tech stack:** NestJS 11, TypeScript, ESLint 10, dependency-cruiser 18, Jest, pnpm.

---

## Task 1: Encode the Nest application-DI boundary

**Files:**

- Create: `test/unit/toolchain/application-nest-di-boundary.spec.ts`
- Modify: `eslint.config.mjs`
- Modify: `.dependency-cruiser.cjs`
- Modify: `docs/architecture/module-boundaries.md`

### Step 1: Write the failing lint-policy contract

Use the ESLint Node API and `lintText(..., { filePath })` to exercise the real flat config. Cover these cases:

- `Inject` and `Injectable` imported from `@nestjs/common` in `src/modules/example/application/example.use-case.ts` are accepted.
- `HttpException` and `Logger` from `@nestjs/common` are rejected there.
- `ConfigService` from `@nestjs/config` is rejected there.
- Prisma, Redis and application-to-outer-layer imports remain rejected.
- `Injectable` is rejected in `src/shared/application/example.ts`.

Run:

```bash
pnpm exec jest --config jest.unit.config.ts --runInBand test/unit/toolchain/application-nest-di-boundary.spec.ts
```

Expected: FAIL because the current application rule rejects every Nest import.

### Step 2: Split the ESLint policy by application scope

In `eslint.config.mjs`:

- keep `src/shared/application/**/*.ts` fully framework-free;
- give `src/modules/*/application/**/*.ts` a dedicated rule that permits only named `Inject` and `Injectable` imports from the exact module `@nestjs/common`;
- reject default, namespace, type-only and all other named imports from `@nestjs/common`;
- reject every other `@nestjs/**` package plus Prisma, OpenTelemetry, Express, Redis and logging frameworks;
- preserve all existing outer-layer restrictions.

Prefer explicit `no-restricted-imports` `paths`/`patterns` selectors over a custom ESLint rule.

### Step 3: Narrow dependency-cruiser without weakening shared application

Replace the blanket application framework rule with:

- a module-application rule that permits the package path `@nestjs/common` but still rejects every other framework package;
- an explicit shared-application framework rule that still rejects all Nest packages;
- the existing generated-Prisma and outer-adapter rules unchanged.

The named-import restriction remains ESLint’s responsibility.

### Step 4: Document the exception and its boundary

Update `docs/architecture/module-boundaries.md` to state:

- runtime module application classes may use only Nest’s `@Injectable()` and `@Inject()` as composition metadata;
- application dependencies remain ports, never adapter classes;
- domain and shared application remain framework-free;
- no Nest HTTP exceptions, config, logger, Prisma, Redis, presentation, infrastructure or composition imports are allowed in application code.

### Step 5: Run focused verification

Run the focused Jest contract, ESLint, and dependency-cruiser:

```bash
pnpm exec jest --config jest.unit.config.ts --runInBand test/unit/toolchain/application-nest-di-boundary.spec.ts
pnpm run lint
pnpm run architecture:check
```

Expected: PASS.

### Step 6: Commit

```bash
git add test/unit/toolchain/application-nest-di-boundary.spec.ts eslint.config.mjs .dependency-cruiser.cjs docs/architecture/module-boundaries.md
git commit -m "refactor(architecture): allow Nest application DI metadata"
```

## Task 2: Prove direct Nest construction through port tokens

**Files:**

- Create: `test/unit/modules/auth/application-di.spec.ts`
- Modify: `src/modules/auth/application/auth-persistence.port.ts`
- Modify: `src/modules/auth/application/password-hasher.port.ts`
- Modify: `src/modules/auth/application/login-rate-limiter.port.ts`
- Modify: `src/modules/auth/application/session-store.port.ts`
- Modify: `src/modules/auth/application/auth-audit.port.ts`
- Modify: `src/modules/auth/application/auth.types.ts`
- Modify: `src/modules/auth/application/login.use-case.ts`
- Modify: `src/modules/auth/application/authenticate-session.use-case.ts`
- Modify: `src/modules/auth/application/logout.use-case.ts`
- Modify: `src/modules/auth/application/get-csrf-token.query.ts`
- Modify: `src/modules/auth/application/list-sessions.query.ts`
- Modify: `src/modules/auth/application/revoke-session.use-case.ts`
- Modify: `src/modules/auth/application/logout-all.use-case.ts`
- Modify: `src/modules/auth/application/change-password.use-case.ts`
- Modify: `src/modules/auth/application/create-initial-admin.use-case.ts`
- Modify: `src/modules/auth/application/get-me.query.ts`

### Step 1: Write a failing Nest-container test

Build a `TestingModule` with:

- fake values under application port tokens;
- a dummy-password-hash value token;
- a no-op cleanup-observer value token;
- `RoleRegistry` as a supplied value;
- the auth use-case/query classes registered directly, without per-class factories.

Resolve every runtime application class and assert representative methods can execute with the injected fakes. Also keep direct `new UseCase(...)` unit construction supported where existing unit tests rely on default audit/observer arguments.

Run:

```bash
pnpm exec jest --config jest.unit.config.ts --runInBand test/unit/modules/auth/application-di.spec.ts
```

Expected: FAIL because the port tokens and Nest metadata do not exist yet.

### Step 2: Add application-owned injection tokens

Declare exact, documented `unique symbol` tokens next to the contracts they identify:

- `AUTH_PERSISTENCE`
- `PASSWORD_HASHER`
- `LOGIN_RATE_LIMITER`
- `SESSION_STORE`
- `AUTH_AUDIT`
- `AUTH_SESSION_CLEANUP_OBSERVER`
- `AUTH_DUMMY_PASSWORD_HASH`

Add or reuse immutable no-op values for optional audit and cleanup behavior. Preserve every exported-contract TSDoc requirement.

### Step 3: Decorate runtime application classes

For each runtime auth use case/query:

- add `@Injectable()`;
- add `@Inject(PORT_TOKEN)` to constructor parameters typed as interfaces or primitives;
- inject `TRANSACTION_PORT` for `TransactionPort`;
- leave class-token dependencies such as `RoleRegistry` as class-token injection;
- preserve constructor defaults needed by direct unit construction, without making Nest rely on omitted optional dependencies;
- do not import any adapter, config service, logger or HTTP concern.

`GetMeQuery`, which has no constructor dependencies, still receives `@Injectable()` so it follows the same runtime-class convention. `CreateInitialAdminUseCase` remains directly constructible by its CLI composition path.

### Step 4: Run focused application tests

Run:

```bash
pnpm exec jest --config jest.unit.config.ts --runInBand test/unit/modules/auth/application-di.spec.ts test/unit/modules/auth
pnpm run typecheck
```

Expected: PASS.

### Step 5: Commit

```bash
git add test/unit/modules/auth/application-di.spec.ts src/modules/auth/application
git commit -m "refactor(auth): make application classes injectable"
```

## Task 3: Replace auth use-case factories with standard providers

**Files:**

- Modify: `src/modules/auth/composition/auth.module.ts`
- Modify: `test/unit/modules/auth/application-di.spec.ts`
- Modify: existing auth composition/bootstrap tests only if their expected provider shape changes

### Step 1: Extend the failing contract to inspect real composition

Add assertions that the auth composition uses:

- application classes directly in `providers`;
- `useExisting` aliases from application port tokens to adapter classes;
- `useValue` only for the dummy password hash and no-op observer;
- no `useFactory` provider for an application use-case/query.

Prefer compiling the real `AuthModule` only if it can be done without network/database lifecycle side effects. Otherwise export no new generic provider abstraction: inspect Nest module metadata and keep the container test from Task 2 as the runtime proof.

Run the focused test and confirm it fails against the current factory-heavy module.

### Step 2: Simplify `AuthModule`

Keep existing factories only for runtime-derived adapters and presentation/platform policies:

- Redis session store configuration;
- Redis login limiter configuration;
- cookie, metadata, guards and conditional docs policy where configuration is genuinely required.

Register application classes directly. Bind interface tokens:

- application port token → existing concrete adapter with `useExisting`;
- transaction token remains supplied by `DatabaseModule`;
- primitive/no-op tokens → `useValue`.

Do not add a generic provider helper or a global DI registry.

### Step 3: Verify focused auth wiring

Run:

```bash
pnpm exec jest --config jest.unit.config.ts --runInBand test/unit/modules/auth/application-di.spec.ts test/unit/bootstrap/api.module.spec.ts
pnpm run typecheck
pnpm run architecture:check
```

Expected: PASS.

### Step 4: Commit

```bash
git add src/modules/auth/composition/auth.module.ts test/unit/modules/auth
git commit -m "refactor(auth): use standard Nest providers"
```

## Task 4: Run the starter foundation gate

**Files:**

- Modify only files required by failures caused by Tasks 1–3.

### Step 1: Run formatting

```bash
pnpm exec prettier --write .dependency-cruiser.cjs eslint.config.mjs docs/architecture/module-boundaries.md src/modules/auth test/unit/toolchain/application-nest-di-boundary.spec.ts test/unit/modules/auth/application-di.spec.ts
```

### Step 2: Run the required final gate

Activate the repository Node version from `.nvmrc`, then run:

```bash
pnpm check:quick
```

Expected: PASS with formatting, Prisma/OpenAPI checks, lint, typecheck, unit tests, architecture check and compiled build all green.

### Step 3: Review the branch diff

Verify:

- application classes depend only on port interfaces plus Nest `Inject`/`Injectable`;
- shared application and domain contain no Nest imports;
- no application `useFactory` remains in `AuthModule`;
- runtime-derived adapter factories are unchanged;
- no unrelated user files are included.

### Step 4: Commit any gate-only fixes

If formatting or a directly caused gate fix changed files:

```bash
git add <exact changed files>
git commit -m "chore(auth): satisfy foundation checks"
```

Do not create an empty commit.
