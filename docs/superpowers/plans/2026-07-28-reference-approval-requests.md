# Reference Approval Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-wired `approval-requests` reference business module that proves module-local RBAC, Prisma persistence, concurrent state transitions, custom RFC 9457 codes, and OpenAPI synchronization.

**Architecture:** Preserve the existing five module-local layers. Generalize the HTTP problem boundary into root-composed module contributions, expose only a narrow auth presentation integration, and keep approval policy inside its own domain/application. The default API imports the module and the existing PostgreSQL/Redis/auth platform remains the only runtime foundation.

**Tech Stack:** Node.js `24.18.0`, pnpm `11.15.1`, TypeScript `7.0.2`, NestJS `11.1.28`, Prisma `7.9.0`, PostgreSQL, Jest `30.4.2`, Testcontainers `12.0.4`, RFC 9457, OpenAPI 3.0.3.

## Global Constraints

- Work only on `feat/reference-approval-requests`, which starts at design commit `fd2d7af`.
- Read `docs/superpowers/specs/2026-07-28-reference-approval-requests-design.md` before Task 1.
- Use TDD: add one focused failing test, observe the expected failure, implement the minimum behavior, and rerun the focused test before each commit.
- Add or update TSDoc for every hand-written exported TypeScript contract according to `docs/architecture/tsdoc-guidelines.md`.
- Preserve `domain → application → infrastructure/presentation → composition → bootstrap` directions from `docs/architecture/module-boundaries.md`.
- Do not add dependencies, a generic CRUD abstraction, a global application error service, a global repository/service locator, or application Redis usage.
- `platform` must not import a business module. `approval-requests/application` must not import NestJS, Prisma, platform, bootstrap, or auth.
- Do not rewrite `20260720000000_baseline` or `20260721090000_auth_core`; add one later migration.
- Never expose exception messages, Prisma errors, rejected values, cookies, session tokens, database URLs, or credentials in HTTP responses/log assertions.
- Update the committed OpenAPI file only with `pnpm openapi:generate`.
- Preserve unrelated `.worktrees/` and `docs/superpowers/plans/2026-07-26-milestone-07-deployment-recovery-follow-up.md`.
- Do not push, create a PR, merge, deploy, or modify hosted environments.

## Target File Structure

New source files:

```text
src/shared/application/application.error.ts
src/shared/application/permission.ts
src/bootstrap/api/api-auth.roles.ts
src/bootstrap/api/api-http-problems.ts
src/modules/auth/composition/auth-http-problem.contribution.ts
src/modules/auth/presentation/current-principal.decorator.ts
src/platform/http/errors/http-problem.registry.ts
src/modules/approval-requests/
├── index.ts
├── domain/
│   └── approval-request.ts
├── application/
│   ├── approval-request-errors.ts
│   ├── approval-request-permissions.ts
│   ├── approval-request-repository.port.ts
│   ├── create-approval-request.use-case.ts
│   ├── decide-approval-request.use-case.ts
│   └── get-approval-request.query.ts
├── infrastructure/
│   ├── prisma-approval-request.mapper.ts
│   └── prisma-approval-request.repository.ts
├── presentation/
│   ├── approval-request.controller.ts
│   ├── approval-request.dto.ts
│   ├── approval-request-response.dto.ts
│   └── approval-request-problem.definitions.ts
└── composition/
    ├── approval-request-http-problem.contribution.ts
    ├── approval-request-role.contribution.ts
    └── approval-requests.module.ts
```

New tests:

```text
test/unit/platform/http/errors/http-problem.registry.spec.ts
test/unit/modules/auth/composition/auth-http-problem.contribution.spec.ts
test/unit/modules/auth/presentation/current-principal.decorator.spec.ts
test/unit/modules/approval-requests/domain/approval-request.spec.ts
test/unit/modules/approval-requests/application/approval-request-use-cases.spec.ts
test/unit/modules/approval-requests/composition/approval-request-http-problem.contribution.spec.ts
test/integration/modules/approval-requests/prisma-approval-request.repository.integration.spec.ts
test/e2e/approval-requests/approval-requests.e2e.spec.ts
```

Files intentionally modified together:

```text
prisma/schema.prisma
prisma/migrations/20260728210000_approval_requests/migration.sql
src/bootstrap/api/api.module.ts
src/bootstrap/api/configure-api.ts
src/bootstrap/contracts/generate-openapi.ts
src/modules/auth/index.ts
src/modules/auth/application/auth-errors.ts
src/modules/auth/application/role-registry.ts
src/modules/auth/composition/auth.module.ts
src/modules/auth/presentation/authentication.guard.ts
src/platform/http/docs/api-problem-responses.decorator.ts
src/platform/http/docs/configure-api-docs.ts
src/platform/http/docs/openapi-document.ts
src/platform/http/docs/problem-response.dto.ts
src/platform/http/errors/http-errors.module.ts
src/platform/http/errors/http-problem.mapper.ts
src/platform/http/errors/problem-exception.filter.ts
src/platform/http/errors/problem-registry.ts
src/platform/http/errors/problem.contracts.ts
test/e2e/support/create-auth-test-runtime.ts
test/e2e/openapi/openapi-problem-conformance.e2e.spec.ts
test/e2e/openapi/openapi-response-conformance.e2e.spec.ts
test/e2e/openapi/docs-test-harness.ts
test/e2e/problems/problem-contract.e2e.spec.ts
test/integration/platform/database/migration-from-empty.integration.spec.ts
test/unit/modules/auth/application/role-registry.spec.ts
test/unit/modules/auth/presentation/authentication.guard.spec.ts
test/unit/platform/http/errors/http-problem.mapper.spec.ts
test/unit/platform/http/errors/problem-exception.filter.spec.ts
test/unit/platform/http/errors/problem-registry.spec.ts
docs/api/openapi.json
docs/api/problem-types.md
docs/architecture/errors-logging-observability.md
docs/architecture/foundation-scope.md
docs/architecture/module-boundaries.md
docs/architecture/openapi-contracts.md
docs/roadmap.md
src/modules/README.md
```

---

### Task 1: Root-Composed Safe HTTP Problem Registry

**Files:**

- Create: `src/shared/application/application.error.ts`
- Create: `src/platform/http/errors/http-problem.registry.ts`
- Create: `src/modules/auth/composition/auth-http-problem.contribution.ts`
- Create: `src/bootstrap/api/api-http-problems.ts`
- Create: `test/unit/platform/http/errors/http-problem.registry.spec.ts`
- Create: `test/unit/modules/auth/composition/auth-http-problem.contribution.spec.ts`
- Modify: `src/shared/application/README.md`
- Modify: `src/modules/auth/application/auth-errors.ts`
- Modify: `src/modules/auth/composition/auth.module.ts`
- Modify: `src/platform/http/errors/problem.contracts.ts`
- Modify: `src/platform/http/errors/problem-registry.ts`
- Modify: `src/platform/http/errors/http-problem.mapper.ts`
- Modify: `src/platform/http/errors/problem-exception.filter.ts`
- Modify: `src/platform/http/errors/http-errors.module.ts`
- Modify: `src/bootstrap/api/api.module.ts`
- Modify: `test/unit/platform/http/errors/http-problem.mapper.spec.ts`
- Modify: `test/unit/platform/http/errors/problem-exception.filter.spec.ts`
- Modify: `test/e2e/problems/problem-contract.e2e.spec.ts`
- Modify: `test/e2e/openapi/openapi-problem-conformance.e2e.spec.ts`
- Modify: `test/e2e/auth/auth-test-harness.ts`
- Modify: `test/e2e/logging/access-log.e2e.spec.ts`
- Modify: `test/e2e/http/http-bootstrap.e2e.spec.ts`

**Interfaces:**

- Produces:

```ts
export abstract class ApplicationError<
  TCode extends string,
> extends Error {
  protected constructor(
    public readonly code: TCode,
    message: string,
    options?: ErrorOptions,
  )
}

export interface HttpProblemMapping {
  readonly code: string
  readonly errors?: readonly ProblemFieldError[]
  readonly retryAfterSeconds?: number
}

export type HttpProblemMapper = (
  error: unknown,
) => HttpProblemMapping | undefined

export interface HttpProblemContribution {
  readonly definitions: readonly RegisteredProblemDefinition[]
  readonly map: HttpProblemMapper
}

export class HttpProblemRegistry {
  public constructor(
    contributions: readonly HttpProblemContribution[],
  )
  public readonly definitions: readonly RegisteredProblemDefinition[]
  public map(error: unknown): MappedHttpProblem
}

export const CORE_HTTP_PROBLEM_CONTRIBUTION: HttpProblemContribution
export const AUTH_HTTP_PROBLEM_CONTRIBUTION: HttpProblemContribution
export const API_HTTP_PROBLEM_CONTRIBUTIONS:
  readonly HttpProblemContribution[]
export const API_PROBLEM_CATALOG:
  readonly RegisteredProblemDefinition[]
```

- Preserves `MappedHttpProblem` fields: `definition`, optional `errors`,
  optional `retryAfterSeconds`, and `unexpected`.
- `HttpProblemRegistry` rejects duplicate `code`, `slug`, and absolute `type`.
- Registry mappers recognize explicit error classes; an arbitrary `{ code:
'...' }` is not an expected failure.
- `HttpErrorsModule.forRoot(contributions)` is the only root registration of
  `APP_FILTER`.

- [ ] **Step 1: Add failing registry unit tests**

Create `test/unit/platform/http/errors/http-problem.registry.spec.ts` with
these cases:

```ts
class ExampleError extends ApplicationError<'EXAMPLE_CONFLICT'> {
  public constructor() {
    super('EXAMPLE_CONFLICT', 'private example detail')
  }
}

it('maps only an explicitly contributed application error', () => {
  const registry = new HttpProblemRegistry([
    CORE_HTTP_PROBLEM_CONTRIBUTION,
    {
      definitions: [
        defineProblemDefinition({
          slug: 'example-conflict',
          code: 'EXAMPLE_CONFLICT',
          status: 409,
          title: 'Example conflict',
          detail: 'The example cannot transition.',
        }),
      ],
      map: (error) =>
        error instanceof ExampleError
          ? { code: 'EXAMPLE_CONFLICT' }
          : undefined,
    },
  ])

  expect(registry.map(new ExampleError()).definition.code).toBe(
    'EXAMPLE_CONFLICT',
  )
  expect(
    registry.map(
      Object.assign(new Error('private'), {
        code: 'EXAMPLE_CONFLICT',
      }),
    ).definition.code,
  ).toBe('INTERNAL_ERROR')
})

it('rejects duplicate codes, slugs and types at construction', () => {
  expect(
    () =>
      new HttpProblemRegistry([
        CORE_HTTP_PROBLEM_CONTRIBUTION,
        {
          definitions: [PROBLEM_CATALOG[0]!],
          map: () => undefined,
        },
      ]),
  ).toThrow('Duplicate HTTP problem definition')
})
```

- [ ] **Step 2: Run the focused registry test and observe RED**

Run:

```bash
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.unit.config.mjs --runInBand \
  test/unit/platform/http/errors/http-problem.registry.spec.ts
```

Expected: FAIL because `ApplicationError`, `HttpProblemRegistry`,
`defineProblemDefinition`, and contribution exports do not exist.

- [ ] **Step 3: Add the shared application error and problem contracts**

Implement `ApplicationError<TCode>` with TSDoc. It must retain only an internal
message and stable code; HTTP status/type/detail do not belong in this class.

In `problem.contracts.ts`, add `MappedHttpProblem` plus the
mapping/contribution interfaces so the runtime registry does not import a type
back from the core mapper. In
`problem-registry.ts`, retain the existing starter namespace and core catalog,
and add:

```ts
export function defineProblemDefinition<const TCode extends string>(
  definition: ProblemDefinition & { readonly code: TCode },
): RegisteredProblemDefinition & { readonly code: TCode } {
  return Object.freeze({
    ...definition,
    type: `${PROBLEM_BASE_URI}/${definition.slug}`,
  })
}
```

Build `PROBLEM_CATALOG` only through that helper so approval definitions can
use the identical URI policy without being added to the core array.

- [ ] **Step 4: Implement registry composition and core mapping**

Implement `HttpProblemRegistry` so it:

1. freezes a deterministic flattened definition array;
2. validates duplicate code/slug/type;
3. asks each mapper in declared order;
4. resolves returned codes through its private definition map;
5. treats an unknown mapper result or completely unknown error as
   `INTERNAL_ERROR` with `unexpected: true`.

Refactor `http-problem.mapper.ts` to export
`CORE_HTTP_PROBLEM_CONTRIBUTION`. It maps only:

- `RequestValidationError`;
- the finite body-parser 413 discriminator;
- known `HttpException` statuses;
- `DatabaseUnavailableError` to `DEPENDENCY_UNAVAILABLE`.

It must not know `AUTH_*` or `APPROVAL_*`.

- [ ] **Step 5: Move auth mapping into the auth composition boundary**

Make `AuthError` extend `ApplicationError<AuthFailureCode>`. Add
`AUTH_HTTP_PROBLEM_CONTRIBUTION` under auth composition with an exhaustive:

```ts
const AUTH_FAILURE_PROBLEM_CODES = {
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_REQUIRED',
  AUTHORIZATION_DENIED: 'AUTHORIZATION_DENIED',
  AUTH_DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  AUTH_RATE_LIMITED: 'RATE_LIMIT_EXCEEDED',
  AUTH_SESSION_NOT_FOUND: 'NOT_FOUND',
  AUTH_STATE_CONFLICT: 'CONFLICT',
  AUTH_CSRF_REJECTED: 'AUTHORIZATION_DENIED',
} as const satisfies Readonly<Record<AuthFailureCode, CoreProblemCode>>
```

Recognize only `error instanceof AuthError`. Preserve the bounded
`retryAfterSeconds` projection for `AuthRateLimitedError`.

- [ ] **Step 6: Make the Nest error module root-configured**

Implement:

```ts
public static forRoot(
  contributions: readonly HttpProblemContribution[],
): DynamicModule
```

Provide one frozen `HttpProblemRegistry`, inject it into
`ProblemExceptionFilter`, and register the sole `APP_FILTER`. Remove
`HttpErrorsModule` from `AuthModule`.

Create `API_HTTP_PROBLEM_CONTRIBUTIONS` and `API_PROBLEM_CATALOG` in
`src/bootstrap/api/api-http-problems.ts`. Import
`HttpErrorsModule.forRoot(API_HTTP_PROBLEM_CONTRIBUTIONS)` from `ApiModule`.

- [ ] **Step 7: Update isolated test harnesses and existing mapper/filter tests**

Every isolated test module must use:

```ts
HttpErrorsModule.forRoot([
  CORE_HTTP_PROBLEM_CONTRIBUTION,
  AUTH_HTTP_PROBLEM_CONTRIBUTION,
])
```

Every direct filter construction must pass:

```ts
new HttpProblemRegistry([
  CORE_HTTP_PROBLEM_CONTRIBUTION,
  AUTH_HTTP_PROBLEM_CONTRIBUTION,
])
```

Update mapper tests into separate core and auth expectations. Add the
compile-time exhaustive `Record<AuthFailureCode, CoreProblemCode>` assertion
inside the auth contribution test.

- [ ] **Step 8: Run focused HTTP/auth tests and observe GREEN**

Run:

```bash
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.unit.config.mjs --runInBand \
  test/unit/platform/http/errors/http-problem.registry.spec.ts \
  test/unit/platform/http/errors/http-problem.mapper.spec.ts \
  test/unit/platform/http/errors/problem-exception.filter.spec.ts \
  test/unit/modules/auth/composition/auth-http-problem.contribution.spec.ts \
  test/unit/modules/auth/presentation/authentication.guard.spec.ts
```

Expected: PASS with no raw exception detail in mapped/filter assertions.

- [ ] **Step 9: Commit Task 1**

```bash
git add \
  src/shared/application \
  src/platform/http/errors \
  src/modules/auth/application/auth-errors.ts \
  src/modules/auth/composition \
  src/bootstrap/api/api-http-problems.ts \
  src/bootstrap/api/api.module.ts \
  test/unit/platform/http/errors \
  test/unit/modules/auth/composition \
  test/unit/modules/auth/presentation/authentication.guard.spec.ts \
  test/e2e/auth/auth-test-harness.ts \
  test/e2e/problems/problem-contract.e2e.spec.ts \
  test/e2e/openapi/openapi-problem-conformance.e2e.spec.ts \
  test/e2e/logging/access-log.e2e.spec.ts \
  test/e2e/http/http-bootstrap.e2e.spec.ts
git commit -m "refactor(http): compose module problem mappings"
```

---

### Task 2: Product-Owned Roles and Public Current Principal Contract

**Files:**

- Create: `src/bootstrap/api/api-auth.roles.ts`
- Create: `src/shared/application/permission.ts`
- Create: `src/modules/auth/presentation/current-principal.decorator.ts`
- Create: `test/unit/modules/auth/presentation/current-principal.decorator.spec.ts`
- Modify: `src/modules/auth/index.ts`
- Modify: `src/modules/auth/application/permission.ts`
- Modify: `src/modules/auth/application/role-registry.ts`
- Modify: `src/modules/auth/composition/auth.module.ts`
- Modify: `src/modules/auth/presentation/authentication.guard.ts`
- Modify: `src/bootstrap/api/api.module.ts`
- Modify: `test/unit/modules/auth/application/role-registry.spec.ts`
- Modify: `test/unit/modules/auth/presentation/authentication.guard.spec.ts`
- Modify: `test/unit/bootstrap/api.module.spec.ts`

**Interfaces:**

- Produces:

```ts
export const CurrentPrincipal: (...dataOrPipes: unknown[]) => ParameterDecorator

export function attachAuthenticatedPrincipal(
  request: object,
  principal: AuthenticatedPrincipal,
): void

export function readAuthenticatedPrincipal(
  request: object,
): AuthenticatedPrincipal

export interface AuthModuleOptions {
  readonly roleDefinitions: readonly RoleDefinition[]
}

export class AuthModule {
  public static forRoot(options: AuthModuleOptions): DynamicModule
}

export const API_ROLE_DEFINITIONS: readonly RoleDefinition[]
```

- `CurrentPrincipal` is re-exported only through `@/modules/auth`.
- The request symbol stays private to
  `current-principal.decorator.ts`; raw session state stays in
  `AuthRequestContext`.
- `approval-requests` may later import only
  `CurrentPrincipal`, `RequirePermission`, and `AuthenticatedPrincipal` from
  the `@/modules/auth` public API. Approval application imports
  `PermissionKey/definePermissions` from
  `@/shared/application/permission`, never from auth.

- [ ] **Step 1: Add failing current-principal tests**

Test the public behavior:

```ts
it('stores one non-enumerable principal and reads it through the decorator', () => {
  const request = {}
  attachAuthenticatedPrincipal(request, principal)

  expect(Object.keys(request)).toEqual([])
  expect(readAuthenticatedPrincipal(request)).toBe(principal)
})

it('fails closed when no guard attached a principal', () => {
  expect(() => readAuthenticatedPrincipal({})).toThrow(
    AuthenticationRequiredError,
  )
})
```

Expose `readAuthenticatedPrincipal(request)` for the decorator implementation
and unit test, with TSDoc. The `CurrentPrincipal` decorator delegates to it.

- [ ] **Step 2: Run the focused tests and observe RED**

```bash
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.unit.config.mjs --runInBand \
  test/unit/modules/auth/presentation/current-principal.decorator.spec.ts \
  test/unit/modules/auth/application/role-registry.spec.ts
```

Expected: FAIL because the principal integration and configurable role
registry do not exist.

- [ ] **Step 3: Implement the request-local principal integration**

Use a private symbol and `Object.defineProperty` with `enumerable: false`,
`writable: false`, and `configurable: false`. In `AuthenticationGuard`, attach
the principal only after `authenticate.execute` succeeds, then prepare the
existing ALS context.

Re-export `CurrentPrincipal` from `src/modules/auth/index.ts`. Update its
package documentation to distinguish the framework-free application API from
the narrow Nest presentation integration. Also re-export
`RequirePermission`; no consumer may deep-import auth presentation.

- [ ] **Step 4: Make role definitions an explicit product input**

Extract the framework-free `PermissionKey` brand and `definePermissions` into
`src/shared/application/permission.ts`. Keep
`src/modules/auth/application/permission.ts` as an explicit re-export so the
existing auth public API remains source-compatible. Auth and approval are the
two independent shared-contract consumers.

Change:

```ts
export function createAuthRoleRegistry(
  definitions: readonly RoleDefinition[],
): RoleRegistry {
  return new RoleRegistry(definitions)
}
```

Retain `SYSTEM_ADMIN_PERMISSIONS = definePermissions(['system.docs.read'])`,
but remove `SYSTEM_ADMIN_ROLE` as an auth-owned complete product role.

Add a private `AUTH_ROLE_DEFINITIONS` DI token in auth composition.
`AuthModule.forRoot({ roleDefinitions })` provides the frozen definitions;
the existing `RoleRegistry` provider injects that token.

Create the initial root catalog:

```ts
export const API_ROLE_DEFINITIONS = Object.freeze([
  Object.freeze({
    key: 'system.admin',
    permissions: SYSTEM_ADMIN_PERMISSIONS,
  }),
])
```

Change `ApiModule` to import
`AuthModule.forRoot({ roleDefinitions: API_ROLE_DEFINITIONS })`.

- [ ] **Step 5: Add unit assertions for explicit role composition**

Assert:

- `createAuthRoleRegistry([])` has no implicit system role;
- duplicate product definitions still fail;
- the configured `system.admin` resolves `system.docs.read`;
- `ApiModule.forRoot` compiles with the explicit definitions.

- [ ] **Step 6: Run auth/bootstrap tests and observe GREEN**

```bash
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.unit.config.mjs --runInBand \
  test/unit/modules/auth/application/role-registry.spec.ts \
  test/unit/modules/auth/presentation/current-principal.decorator.spec.ts \
  test/unit/modules/auth/presentation/authentication.guard.spec.ts \
  test/unit/bootstrap/api.module.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add \
  src/shared/application/permission.ts \
  src/bootstrap/api/api-auth.roles.ts \
  src/bootstrap/api/api.module.ts \
  src/modules/auth \
  test/unit/modules/auth \
  test/unit/bootstrap/api.module.spec.ts
git commit -m "feat(auth): expose product integration contracts"
```

---

### Task 3: Approval Domain and Application Policies

**Files:**

- Create: `src/modules/approval-requests/index.ts`
- Create: `src/modules/approval-requests/domain/approval-request.ts`
- Create: `src/modules/approval-requests/application/approval-request-errors.ts`
- Create: `src/modules/approval-requests/application/approval-request-permissions.ts`
- Create: `src/modules/approval-requests/application/approval-request-repository.port.ts`
- Create: `src/modules/approval-requests/application/create-approval-request.use-case.ts`
- Create: `src/modules/approval-requests/application/get-approval-request.query.ts`
- Create: `src/modules/approval-requests/application/decide-approval-request.use-case.ts`
- Create: `src/modules/approval-requests/composition/approval-request-role.contribution.ts`
- Create: `test/unit/modules/approval-requests/domain/approval-request.spec.ts`
- Create: `test/unit/modules/approval-requests/application/approval-request-use-cases.spec.ts`

**Interfaces:**

```ts
export type ApprovalRequestStatus = 'pending' | 'approved' | 'rejected'
export type ApprovalDecision = Exclude<ApprovalRequestStatus, 'pending'>

export interface ApprovalRequest {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly status: ApprovalRequestStatus
  readonly createdByUserId: string
  readonly decidedByUserId?: string
  readonly createdAt: Date
  readonly decidedAt?: Date
}

export type ApprovalRequestFailureCode =
  | 'APPROVAL_REQUEST_NOT_FOUND'
  | 'APPROVAL_REQUEST_ALREADY_DECIDED'
  | 'APPROVAL_SELF_DECISION_FORBIDDEN'

export interface ApprovalRequestRepositoryPort {
  create(request: ApprovalRequest): Promise<ApprovalRequest>
  findById(id: string): Promise<ApprovalRequest | undefined>
  decidePending(input: {
    readonly id: string
    readonly decision: ApprovalDecision
    readonly decidedByUserId: string
    readonly decidedAt: Date
  }): Promise<ApprovalRequest | undefined>
}
```

Use-case inputs:

```ts
CreateApprovalRequestUseCase.execute({
  actorUserId,
  title,
  description,
}): Promise<ApprovalRequest>

GetApprovalRequestQuery.execute({
  actorUserId,
  requestId,
  mayReadAny,
}): Promise<ApprovalRequest>

DecideApprovalRequestUseCase.execute({
  actorUserId,
  requestId,
  decision,
}): Promise<ApprovalRequest>
```

- [ ] **Step 1: Write failing domain tests**

Cover:

```ts
expect(
  createApprovalRequest(
    {
      id,
      title: '  Publish July price list  ',
      description: '  Approve before publication.  ',
      createdByUserId: authorId,
    },
    now,
  ),
).toMatchObject({
  title: 'Publish July price list',
  description: 'Approve before publication.',
  status: 'pending',
})

expect(() => decideApprovalRequest(pending, authorId, 'approved', now)).toThrow(
  ApprovalSelfDecisionForbiddenError,
)

expect(() =>
  decideApprovalRequest(approved, reviewerId, 'rejected', later),
).toThrow(ApprovalRequestAlreadyDecidedError)
```

Also assert empty, over-120 title, and over-2,000 description throw `RangeError`
as programmer-contract failures; they are not mapped as public business codes.

- [ ] **Step 2: Run domain tests and observe RED**

```bash
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.unit.config.mjs --runInBand \
  test/unit/modules/approval-requests/domain/approval-request.spec.ts
```

Expected: FAIL because the approval domain does not exist.

- [ ] **Step 3: Implement the immutable aggregate and module errors**

Implement `createApprovalRequest` and `decideApprovalRequest` as pure functions.
Clone dates in/out or freeze the returned object so callers cannot mutate
terminal state. Apply `trim` only at the edges and preserve internal
whitespace.

Create three concrete errors extending a module-local
`ApprovalRequestError`, which extends
`ApplicationError<ApprovalRequestFailureCode>`. Their messages are internal
constants and are never response details.

- [ ] **Step 4: Write failing application use-case tests**

Use a hand-written in-memory repository double. Assert:

- create delegates one normalized pending aggregate;
- get returns the author’s request with `mayReadAny: false`;
- get returns to a reviewer with `mayReadAny: true`;
- get hides a foreign request with `ApprovalRequestNotFoundError`;
- decide rejects self before calling `decidePending`;
- decide rejects an already terminal snapshot;
- a lost compare-and-set reloads and throws already-decided.

The race assertion must be:

```ts
repository.decidePending.mockResolvedValueOnce(undefined)
repository.findById
  .mockResolvedValueOnce(pending)
  .mockResolvedValueOnce(approved)

await expect(
  useCase.execute({
    actorUserId: reviewerId,
    requestId,
    decision: 'rejected',
  }),
).rejects.toThrow(ApprovalRequestAlreadyDecidedError)
```

- [ ] **Step 5: Run application tests and observe RED**

```bash
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.unit.config.mjs --runInBand \
  test/unit/modules/approval-requests/application/approval-request-use-cases.spec.ts
```

Expected: FAIL because repository port and use cases do not exist.

- [ ] **Step 6: Implement use cases and permissions**

Inject deterministic factories:

```ts
type ApprovalRequestIdFactory = () => string
type ApprovalRequestClock = () => Date
```

Default them to `randomUUID` and `() => new Date()`, while tests pass fixed
values.

Define:

```ts
export const APPROVAL_REQUEST_PERMISSIONS = definePermissions([
  'approval.requests.read',
  'approval.requests.decide',
])
export const APPROVAL_REQUEST_READ_PERMISSION = APPROVAL_REQUEST_PERMISSIONS[0]!
export const APPROVAL_REQUEST_DECIDE_PERMISSION =
  APPROVAL_REQUEST_PERMISSIONS[1]!
```

Application imports `definePermissions` only from
`@/shared/application/permission`. It must not import any auth path,
presentation/composition contract, or `AuthenticatedPrincipal`.

`approval-request-role.contribution.ts` re-exports the frozen permission list
from the module composition boundary. Product bootstrap imports this
composition file, never the module's application path directly.

`src/modules/approval-requests/index.ts` re-exports only framework-free
domain/application contracts needed by another business module. It does not
export Prisma adapters, controllers, DTOs, or the Nest composition class.

- [ ] **Step 7: Run approval unit tests and architecture check**

```bash
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.unit.config.mjs --runInBand \
  test/unit/modules/approval-requests/domain/approval-request.spec.ts \
  test/unit/modules/approval-requests/application/approval-request-use-cases.spec.ts
pnpm architecture:check
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add src/modules/approval-requests test/unit/modules/approval-requests
git commit -m "feat(approval): add request decision policies"
```

---

### Task 4: Prisma Migration and Atomic Repository

**Files:**

- Create: `prisma/migrations/20260728210000_approval_requests/migration.sql`
- Create: `src/modules/approval-requests/infrastructure/prisma-approval-request.mapper.ts`
- Create: `src/modules/approval-requests/infrastructure/prisma-approval-request.repository.ts`
- Create: `test/integration/modules/approval-requests/prisma-approval-request.repository.integration.spec.ts`
- Modify: `prisma/schema.prisma`
- Modify: `test/integration/platform/database/migration-from-empty.integration.spec.ts`

**Interfaces:**

- `PrismaApprovalRequestRepository implements ApprovalRequestRepositoryPort`.
- Constructor:

```ts
public constructor(private readonly provider: PrismaClientProvider)
```

- `decidePending` performs one `updateMany` with `id` and `status: 'PENDING'`;
  on count `1`, it reads and maps the updated row; on count `0`, it returns
  `undefined`.
- Adapter maps unavailable/admission/driver failures to
  `DatabaseUnavailableError`; it never exposes Prisma errors to application or
  HTTP.

- [ ] **Step 1: Add schema and migration acceptance assertions first**

Update `migration-from-empty.integration.spec.ts` to expect:

```ts
expect(migrations.rows).toEqual([
  { migration_name: '20260720000000_baseline' },
  { migration_name: '20260721090000_auth_core' },
  { migration_name: '20260728210000_approval_requests' },
])

expect(tables.rows).toContainEqual({ table_name: 'approval_requests' })
```

Add a query asserting the database rejects a terminal row without
`decided_by_user_id` and `decided_at`.

- [ ] **Step 2: Run the migration test and observe RED**

```bash
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.integration.config.mjs --runInBand \
  test/integration/platform/database/migration-from-empty.integration.spec.ts
```

Expected: FAIL because the third migration/table does not exist. If Docker is
blocked by the sandbox, rerun the unchanged command with the required
capability rather than diagnosing product code.

- [ ] **Step 3: Extend Prisma schema and add exact SQL migration**

Add:

```prisma
enum ApprovalRequestStatus {
  PENDING
  APPROVED
  REJECTED
}

model ApprovalRequest {
  id              String                @id @default(uuid()) @db.Uuid
  title           String                @db.VarChar(120)
  description     String                @db.VarChar(2000)
  status          ApprovalRequestStatus @default(PENDING)
  createdByUserId String                @map("created_by_user_id") @db.Uuid
  decidedByUserId String?               @map("decided_by_user_id") @db.Uuid
  createdAt       DateTime              @default(now()) @map("created_at")
  decidedAt       DateTime?             @map("decided_at")
  createdBy       User                  @relation("ApprovalRequestCreator", fields: [createdByUserId], references: [id], onDelete: Restrict)
  decidedBy       User?                 @relation("ApprovalRequestDecider", fields: [decidedByUserId], references: [id], onDelete: Restrict)

  @@index([createdByUserId])
  @@map("approval_requests")
}
```

Add inverse creator/decider relation arrays to `User`.

The SQL migration must create the enum/table/index/two foreign keys and:

```sql
CONSTRAINT "approval_requests_decision_state_check" CHECK (
  (
    "status" = 'PENDING'
    AND "decided_by_user_id" IS NULL
    AND "decided_at" IS NULL
  )
  OR
  (
    "status" IN ('APPROVED', 'REJECTED')
    AND "decided_by_user_id" IS NOT NULL
    AND "decided_at" IS NOT NULL
  )
)
```

- [ ] **Step 4: Validate/generate Prisma and rerun migration test**

```bash
pnpm prisma:validate
pnpm prisma:generate
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.integration.config.mjs --runInBand \
  test/integration/platform/database/migration-from-empty.integration.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Add failing real-repository integration tests**

Start PostgreSQL, deploy migrations, connect `PrismaClientProvider`, and insert
two active users. Assert:

1. create/find round-trip maps lowercase domain status;
2. two concurrent `decidePending` calls yield exactly one updated value and one
   `undefined`;
3. stored row contains one immutable decision actor/time;
4. a call after provider close throws `DatabaseUnavailableError`.

Use:

```ts
const results = await Promise.all([
  repository.decidePending(approveInput),
  repository.decidePending(rejectInput),
])
expect(results.filter((value) => value !== undefined)).toHaveLength(1)
expect(results.filter((value) => value === undefined)).toHaveLength(1)
```

- [ ] **Step 6: Run repository integration test and observe RED**

```bash
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.integration.config.mjs --runInBand \
  test/integration/modules/approval-requests/prisma-approval-request.repository.integration.spec.ts
```

Expected: FAIL because mapper/repository do not exist.

- [ ] **Step 7: Implement mapper and atomic repository**

Map Prisma enum values explicitly; do not cast arbitrary strings. Clone Date
objects in the mapper. Wrap provider/Prisma failures at the repository boundary
as `DatabaseUnavailableError`, but allow the expected zero-row compare-and-set
result to return `undefined`.

- [ ] **Step 8: Run approval/database integration tests and observe GREEN**

```bash
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.integration.config.mjs --runInBand \
  test/integration/modules/approval-requests/prisma-approval-request.repository.integration.spec.ts \
  test/integration/platform/database/migration-from-empty.integration.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

```bash
git add \
  prisma/schema.prisma \
  prisma/migrations/20260728210000_approval_requests/migration.sql \
  src/modules/approval-requests/infrastructure \
  test/integration/modules/approval-requests \
  test/integration/platform/database/migration-from-empty.integration.spec.ts
git commit -m "feat(approval): persist approval requests"
```

---

### Task 5: HTTP Presentation, Composition, RBAC, and Real E2E

**Files:**

- Create: `src/modules/approval-requests/presentation/approval-request.dto.ts`
- Create: `src/modules/approval-requests/presentation/approval-request-response.dto.ts`
- Create: `src/modules/approval-requests/presentation/approval-request-problem.definitions.ts`
- Create: `src/modules/approval-requests/presentation/approval-request.controller.ts`
- Create: `src/modules/approval-requests/composition/approval-request-http-problem.contribution.ts`
- Create: `src/modules/approval-requests/composition/approval-requests.module.ts`
- Create: `test/unit/modules/approval-requests/composition/approval-request-http-problem.contribution.spec.ts`
- Create: `test/e2e/approval-requests/approval-requests.e2e.spec.ts`
- Modify: `src/platform/http/docs/api-problem-responses.decorator.ts`
- Modify: `src/bootstrap/api/api-auth.roles.ts`
- Modify: `src/bootstrap/api/api-http-problems.ts`
- Modify: `src/bootstrap/api/api.module.ts`
- Modify: `test/e2e/support/create-auth-test-runtime.ts`

**Interfaces:**

Request DTOs:

```ts
export class CreateApprovalRequestDto {
  public title!: string
  public description!: string
}

export class ApprovalRequestPathDto {
  public requestId!: string
}

export class DecideApprovalRequestDto {
  public decision!: ApprovalDecision
}
```

Response DTO:

```ts
export class ApprovalRequestResponseDto {
  public readonly id!: string
  public readonly title!: string
  public readonly description!: string
  public readonly status!: ApprovalRequestStatus
  public readonly createdByUserId!: string
  public readonly decidedByUserId!: string | null
  public readonly createdAt!: Date
  public readonly decidedAt!: Date | null
}
```

Endpoints and operation IDs:

```text
POST /v1/approval-requests
operationId: approvalRequestsCreate

GET /v1/approval-requests/{requestId}
operationId: approvalRequestsGet

PUT /v1/approval-requests/{requestId}/decision
operationId: approvalRequestsDecide
```

- [ ] **Step 1: Add failing module mapping and full-runtime HTTP tests**

Define three module problems with exact public fields:

```text
approval-request-not-found
APPROVAL_REQUEST_NOT_FOUND
404
Approval request not found
The approval request does not exist.

approval-request-already-decided
APPROVAL_REQUEST_ALREADY_DECIDED
409
Approval request already decided
A decision has already been recorded for this request.

approval-self-decision-forbidden
APPROVAL_SELF_DECISION_FORBIDDEN
403
Approval self-decision forbidden
The author cannot decide their own approval request.
```

Assert each concrete error maps to the exact code and an arbitrary object with
the same `.code` does not map.

Create `test/e2e/approval-requests/approval-requests.e2e.spec.ts` with
`createAuthTestRuntime(1)`. Create:

- author with `[]`;
- reviewer with `['approval.reviewer']`;
- outsider with `[]`;
- self-reviewer with `['approval.reviewer']`.

Log each in through the real `/v1/auth/login`. For unsafe requests send the
session cookie, `Origin`, `Content-Type: application/json`, and
`X-CSRF-Token`.

Assert:

1. missing cookie → 401 `AUTHENTICATION_REQUIRED`;
2. author create → 201 pending representation;
3. author get → 200;
4. outsider get → 404 `APPROVAL_REQUEST_NOT_FOUND`;
5. outsider decide → 403 `AUTHORIZATION_DENIED`;
6. self-reviewer create then decide → 403
   `APPROVAL_SELF_DECISION_FORBIDDEN`;
7. reviewer decide → 200 terminal representation;
8. repeat decision → 409 `APPROVAL_REQUEST_ALREADY_DECIDED`;
9. every problem uses `application/problem+json`, has `requestId`, and lacks
   internal messages.

- [ ] **Step 2: Run contribution and route tests; observe RED**

```bash
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.unit.config.mjs --runInBand \
  test/unit/modules/approval-requests/composition/approval-request-http-problem.contribution.spec.ts
pnpm build
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.e2e.config.mjs --runInBand \
  test/e2e/approval-requests/approval-requests.e2e.spec.ts
```

Expected: unit FAIL because problem definitions/contribution do not exist; e2e
FAIL because approval routes and the role-aware fixture signature do not exist.

- [ ] **Step 3: Implement module definitions and contribution**

Build definitions through `defineProblemDefinition`. The contribution mapper
must use `instanceof` on the three explicit module errors.

Extend `ApiProblemResponses` to accept either an existing `CoreProblemCode` or
a `RegisteredProblemDefinition`. Existing auth/health decorators remain
source-compatible; approval passes its local definitions directly.

- [ ] **Step 4: Add DTOs and controller**

Use `@Transform` to trim string edges before `@MinLength/@MaxLength`.
Use `@IsUUID('4')` for `requestId` and `@IsEnum(['approved', 'rejected'])` or
an equivalent finite enum object for decisions.

Controller rules:

```ts
@Post()
@HttpCode(201)
public create(
  @Body() body: CreateApprovalRequestDto,
  @CurrentPrincipal() principal: AuthenticatedPrincipal,
): Promise<ApprovalRequestResponseDto>

@Get(':requestId')
public get(
  @Param() path: ApprovalRequestPathDto,
  @CurrentPrincipal() principal: AuthenticatedPrincipal,
): Promise<ApprovalRequestResponseDto>

@Put(':requestId/decision')
@RequirePermission(APPROVAL_REQUEST_DECIDE_PERMISSION)
public decide(
  @Param() path: ApprovalRequestPathDto,
  @Body() body: DecideApprovalRequestDto,
  @CurrentPrincipal() principal: AuthenticatedPrincipal,
): Promise<ApprovalRequestResponseDto>
```

`get` passes
`principal.permissions.has(APPROVAL_REQUEST_READ_PERMISSION)` as
`mayReadAny`. Never pass the whole principal into application.

Document exact endpoint failures:

- create: core malformed/authentication/authorization/payload/media
  type/validation/internal/dependency problems;
- get: core authentication/internal/dependency plus the module-local
  not-found problem;
- decide: core malformed/authentication/authorization/payload/media
  type/validation/internal/dependency plus all three module-local problems.

Add `@ApiTags('approval-requests')`, explicit `@ApiOperation({ operationId,
summary, security })`, concrete success DTO decorators, UUID `@ApiParam`, and
`ApiProblemResponses` for those finite sets. Unsafe endpoints declare both
`sessionCookie` and `csrfToken`; GET declares `sessionCookie`.

- [ ] **Step 5: Compose the module and root catalogs**

`ApprovalRequestsModule` imports `DatabaseModule`, provides one
`PrismaApprovalRequestRepository`, and constructs the three use cases through
explicit factories.

Update root roles by importing `APPROVAL_REQUEST_PERMISSIONS` only from
`approval-request-role.contribution.ts`:

```ts
system.admin = [...SYSTEM_ADMIN_PERMISSIONS, ...APPROVAL_REQUEST_PERMISSIONS]

approval.reviewer = [...APPROVAL_REQUEST_PERMISSIONS]
```

Append `APPROVAL_REQUEST_HTTP_PROBLEM_CONTRIBUTION` to
`API_HTTP_PROBLEM_CONTRIBUTIONS`, and import `ApprovalRequestsModule` in
`ApiModule`.

- [ ] **Step 6: Extend the real auth e2e user fixture**

Change the helper without breaking existing callers:

```ts
createUser(
  email: string,
  passwordHash?: string,
  roleKeys?: readonly string[],
): Promise<string>
```

Default `roleKeys` to `['system.admin']`. Insert zero role rows for `[]`; insert
each explicit role for reviewer fixtures.

- [ ] **Step 7: Build and rerun the focused unit/e2e tests; observe GREEN**

```bash
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.unit.config.mjs --runInBand \
  test/unit/modules/approval-requests/composition/approval-request-http-problem.contribution.spec.ts
pnpm build
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.e2e.config.mjs --runInBand \
  test/e2e/approval-requests/approval-requests.e2e.spec.ts
```

Expected: PASS. If Docker/network access is blocked, rerun unchanged with the
required capability.

- [ ] **Step 8: Run focused unit and architecture gates**

```bash
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.unit.config.mjs --runInBand \
  test/unit/modules/approval-requests \
  test/unit/modules/auth \
  test/unit/platform/http/errors
pnpm architecture:check
```

Expected: PASS.

- [ ] **Step 9: Commit Task 5**

```bash
git add \
  src/modules/approval-requests \
  src/bootstrap/api \
  src/platform/http/docs/api-problem-responses.decorator.ts \
  test/unit/modules/approval-requests \
  test/e2e/approval-requests \
  test/e2e/support/create-auth-test-runtime.ts
git commit -m "feat(approval): expose reference HTTP workflow"
```

---

### Task 6: OpenAPI and Problem Contract Synchronization

**Files:**

- Modify: `src/platform/http/docs/problem-response.dto.ts`
- Modify: `src/platform/http/docs/openapi-document.ts`
- Modify: `src/platform/http/docs/configure-api-docs.ts`
- Modify: `src/bootstrap/api/configure-api.ts`
- Modify: `src/bootstrap/contracts/generate-openapi.ts`
- Modify: `test/e2e/openapi/docs-test-harness.ts`
- Modify: `test/e2e/openapi/openapi-problem-conformance.e2e.spec.ts`
- Modify: `test/e2e/openapi/openapi-response-conformance.e2e.spec.ts`
- Modify: `test/e2e/approval-requests/approval-requests.e2e.spec.ts`
- Modify: `test/unit/platform/http/errors/problem-registry.spec.ts`
- Modify: `docs/api/problem-types.md`
- Modify: `docs/api/openapi.json`

**Interfaces:**

```ts
export function createOpenApiDocument(
  app: INestApplication,
  config: ApplicationRuntimeConfig,
  problems: readonly RegisteredProblemDefinition[],
): OpenAPIObject

export function configureApiDocs(
  app: NestExpressApplication,
  config: ApplicationRuntimeConfig,
  requestContext: RequestContext,
  protectedPolicy: DocsAccessPolicy | null,
  problems: readonly RegisteredProblemDefinition[],
): void
```

- [ ] **Step 1: Add failing parity and operation conformance assertions**

Change problem parity to compare the committed
`ProblemResponseDto.code.enum` against `API_PROBLEM_CATALOG`, not the core
catalog.

Extend approval e2e to call:

```ts
await assertOpenApiResponseConforms('approvalRequestsCreate', created)
await assertOpenApiResponseConforms('approvalRequestsGet', loaded)
await assertOpenApiResponseConforms('approvalRequestsDecide', decided)
await assertProblemResponseConforms(repeatedDecision)
```

Add an assertion that all three approval definitions occur in
`docs/api/problem-types.md`.

- [ ] **Step 2: Run OpenAPI tests and observe RED**

```bash
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.e2e.config.mjs --runInBand \
  test/e2e/openapi/openapi-problem-conformance.e2e.spec.ts
```

Expected: FAIL because the committed schema enum does not contain approval
codes.

- [ ] **Step 3: Make OpenAPI code enum use the composed catalog**

Remove the static `PROBLEM_CATALOG` enum capture from
`ProblemResponseDto`. Keep a canonical uppercase-code pattern in the
decorator.

After `SwaggerModule.createDocument`, set the
`ProblemResponseDto.properties.code.enum` to the sorted composed problem codes
passed to `createOpenApiDocument`. Throw a deterministic configuration error
when the full API contains `ProblemResponseDto` but its code property is
missing.

Pass `app.get(HttpProblemRegistry).definitions` from runtime
`configureApi`. Pass `API_PROBLEM_CATALOG` from offline OpenAPI generation.
The isolated docs harness passes `PROBLEM_CATALOG` because it has no business
controllers.

- [ ] **Step 4: Update human catalog and generate committed OpenAPI**

Append the three exact approval definitions to
`docs/api/problem-types.md`, sorted with the existing table policy.

Run:

```bash
pnpm openapi:generate
pnpm openapi:lint
pnpm openapi:drift
```

Expected: all commands exit `0`; `docs/api/openapi.json` contains the three
paths, operation IDs, DTO schemas, and approval codes.

- [ ] **Step 5: Run focused OpenAPI and approval conformance**

```bash
pnpm build
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.e2e.config.mjs --runInBand \
  test/e2e/openapi/openapi-problem-conformance.e2e.spec.ts \
  test/e2e/openapi/openapi-response-conformance.e2e.spec.ts \
  test/e2e/approval-requests/approval-requests.e2e.spec.ts
```

Expected: PASS. Run with required Docker capability if the sandbox cannot
start Testcontainers.

- [ ] **Step 6: Commit Task 6**

```bash
git add \
  src/platform/http/docs \
  src/bootstrap/api/configure-api.ts \
  src/bootstrap/contracts/generate-openapi.ts \
  test/e2e/openapi \
  test/e2e/approval-requests/approval-requests.e2e.spec.ts \
  test/unit/platform/http/errors/problem-registry.spec.ts \
  docs/api/problem-types.md \
  docs/api/openapi.json
git commit -m "docs(api): publish approval problem contract"
```

---

### Task 7: Architecture Documentation and Full Verification

**Files:**

- Modify: `docs/architecture/module-boundaries.md`
- Modify: `docs/architecture/errors-logging-observability.md`
- Modify: `docs/architecture/foundation-scope.md`
- Modify: `docs/architecture/openapi-contracts.md`
- Modify: `docs/roadmap.md`
- Modify: `src/modules/README.md`

**Documentation requirements:**

- `module-boundaries.md`: document the auth public presentation integration,
  product-owned role composition, and module-owned HTTP problem contributions.
- `errors-logging-observability.md`: document root-composed immutable
  definitions/mappers, duplicate startup failure, explicit class recognition,
  and safe unknown fallback.
- `foundation-scope.md`: distinguish universal foundation from the
  production-wired reference business module.
- `openapi-contracts.md`: document composed code enum and explicit authoring
  flow.
- `roadmap.md`: record the reference slice only as implemented after fresh
  gates; do not claim deployment/hosted evidence.
- `src/modules/README.md`: point readers to `approval-requests` as the first
  maintained vertical reference, not a generic CRUD template.

- [ ] **Step 1: Update architecture and roadmap documentation**

Use wording consistent with the design. Do not describe queues, object storage,
self-service auth, email, list endpoints, or user provisioning as implemented.

- [ ] **Step 2: Run format and static contract gates**

```bash
pnpm exec prettier --write \
  src/shared/application \
  src/bootstrap/api \
  src/bootstrap/contracts/generate-openapi.ts \
  src/modules/auth \
  src/modules/approval-requests \
  src/platform/http \
  prisma/schema.prisma \
  test/unit/modules/approval-requests \
  test/integration/modules/approval-requests \
  test/e2e/approval-requests \
  docs/api/problem-types.md \
  docs/architecture/module-boundaries.md \
  docs/architecture/errors-logging-observability.md \
  docs/architecture/foundation-scope.md \
  docs/architecture/openapi-contracts.md \
  docs/roadmap.md \
  src/modules/README.md
pnpm check:quick
```

Expected: PASS. If Prettier changes source, inspect the diff and keep only
in-scope formatting.

- [ ] **Step 3: Run full local integration/e2e gate**

```bash
pnpm check
```

Expected: PASS when Docker/Testcontainers are available. If the sandbox blocks
Docker, rerun the unchanged command with the required capability. Report a
remaining environment boundary separately from product failures.

- [ ] **Step 4: Inspect architecture and privacy evidence**

Run:

```bash
pnpm architecture:check
rg -n \"@/modules/auth|@/platform|@nestjs|@prisma\" \
  src/modules/approval-requests/application \
  src/modules/approval-requests/domain
rg -n \"APPROVAL_\" src/platform
git diff --check
git status --short
```

Expected:

- architecture check exits `0`;
- forbidden-import searches print no matches;
- `src/platform` contains no approval-specific condition or code;
- diff check exits `0`;
- only in-scope tracked changes plus pre-existing untracked `.worktrees/` and
  the older plan remain.

- [ ] **Step 5: Commit documentation**

```bash
git add \
  docs/architecture/module-boundaries.md \
  docs/architecture/errors-logging-observability.md \
  docs/architecture/foundation-scope.md \
  docs/architecture/openapi-contracts.md \
  docs/roadmap.md \
  src/modules/README.md
git commit -m "docs(approval): document reference module"
```

- [ ] **Step 6: Verify final branch evidence after the commit**

Run fresh:

```bash
pnpm check:quick
pnpm check
git log --oneline --decorate -8
git status --short --branch
```

Record exact suite/test counts and any Docker/environment boundary. Do not
report remote CI, merge, publication, or deployment as complete because this
plan performs none of those actions.
