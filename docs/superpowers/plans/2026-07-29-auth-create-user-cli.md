# Auth Create User CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PostgreSQL-backed operator CLI that creates a login-capable user with zero or more code-owned roles after the one-shot initial administrator bootstrap.

**Architecture:** Keep credential and durable role provisioning inside the existing `auth` module. The CLI bootstrap passes the API root's complete role catalog into an auth application use case, reads the password only from bounded stdin, and persists `User`, `PasswordCredential`, and `UserRole` rows atomically through the existing Prisma auth repository.

**Tech Stack:** Node.js `24.18.0`, pnpm `11.15.1`, TypeScript `7.0.2`, Prisma `7.9.0`, PostgreSQL, Jest `30.4.2`.

## Global Constraints

- Work only in `/private/tmp/nest-js-starter-reference-approval-requests` on `feat/reference-approval-requests`.
- Run every Node/pnpm command with `/Users/denischernykh/.nvm/versions/node/v24.18.0/bin` first in `PATH`.
- Use TDD: add focused failing tests and observe the expected failure before production code.
- Add or update TSDoc for every hand-written exported TypeScript contract according to `docs/architecture/tsdoc-guidelines.md`.
- Preserve the module directions in `docs/architecture/module-boundaries.md`; auth must not import bootstrap or `approval-requests`.
- Use `API_ROLE_DEFINITIONS` as the complete product-owned role catalog supplied by the CLI bootstrap.
- Do not add an HTTP endpoint, self-registration, invitations, email, profile CRUD, dependencies, schema changes, migrations, or a new generic user module.
- Read the password only through `readSecret`; do not accept it as an argument, environment variable, log attribute, or output.
- One Prisma nested create must atomically persist the user, password credential, and deduplicated sorted role assignments.
- Duplicate normalized email is a finite non-exceptional conflict result. An unknown role fails before password hashing or persistence.
- Security audit output must contain only reviewed action/outcome/reason codes and optional opaque user identifiers.
- Preserve unrelated files and do not push, create a PR, merge, deploy, or modify hosted environments.

---

### Task 1: General User Provisioning Command

**Files:**

- Create: `src/modules/auth/application/create-user.use-case.ts`
- Create: `src/modules/auth/composition/user-provisioning.module.ts`
- Create: `src/bootstrap/user/create-user.cli.ts`
- Create: `src/bootstrap/user/main.ts`
- Create: `test/unit/modules/auth/application/create-user.use-case.spec.ts`
- Create: `test/unit/bootstrap/user/create-user.cli.spec.ts`
- Create: `test/integration/modules/auth/create-user.integration.spec.ts`
- Modify: `src/modules/auth/application/auth-audit.port.ts`
- Modify: `src/modules/auth/application/auth-persistence.port.ts`
- Modify: `src/modules/auth/application/auth.types.ts`
- Modify: `src/modules/auth/application/index.ts`
- Modify: `src/modules/auth/infrastructure/prisma-auth.repository.ts`
- Modify: `src/platform/logging/auth-audit.logger.ts`
- Modify: `test/unit/platform/logging/auth-audit.logger.spec.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**

- Produces:

```ts
export interface CreateUserInput {
  readonly email: string
  readonly password: string
  readonly roleKeys: readonly string[]
}

export type CreateUserResult =
  | { readonly created: true; readonly userId: string }
  | { readonly created: false }

export class CreateUserUseCase {
  public constructor(
    persistence: AuthPersistencePort,
    passwords: PasswordHasherPort,
    roles: RoleRegistry,
    audit?: AuthAuditPort,
  )

  public execute(input: CreateUserInput): Promise<CreateUserResult>
}

export interface UserProvisioningInput {
  readonly email: string
  readonly normalizedEmail: string
  readonly passwordHash: string
  readonly roleKeys: readonly string[]
}

export function createUserCommand(
  provider: PrismaClientProvider,
  transaction: TransactionPort,
  audit: AuthAuditPort,
  roleDefinitions: readonly RoleDefinition[],
): CreateUserUseCase

export async function runCreateUserCli(
  argv: readonly string[],
  dependencies: CreateUserCliDependencies,
): Promise<0 | 1>
```

- The package script is `auth:create-user`.
- Accepted argument forms are exactly one `--email value` or `--email=value`, plus zero or more `--role value` or `--role=value`.
- Duplicate role arguments are accepted but persisted once in lexicographic order.
- Examples:

```bash
pnpm auth:create-user -- --email=requester@example.com
pnpm auth:create-user -- --email=reviewer@example.com --role=approval.reviewer
```

- Public CLI output is exactly one of:

```text
User created.
User email already exists.
Unknown user role.
Invalid user creation command.
User creation failed.
```

- [ ] **Step 1: Write focused failing application tests**

Create `test/unit/modules/auth/application/create-user.use-case.spec.ts` that proves:

1. `Admin@Example.com` becomes `normalizedEmail: 'admin@example.com'`;
2. roles `['system.admin', 'approval.reviewer', 'approval.reviewer']` become `['approval.reviewer', 'system.admin']`;
3. a known role assignment is persisted with a hashed password and returns the repository result;
4. an unknown role rejects with `UnknownRoleAssignmentError` before the hasher and repository are called;
5. success, duplicate email, unknown role, and dependency failure emit value-free `user_create` audit events.

- [ ] **Step 2: Run the application test and observe RED**

Run:

```bash
PATH=/Users/denischernykh/.nvm/versions/node/v24.18.0/bin:$PATH \
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.unit.config.mjs --runInBand \
  test/unit/modules/auth/application/create-user.use-case.spec.ts
```

Expected: FAIL because `CreateUserUseCase` and persistence contracts do not exist.

- [ ] **Step 3: Implement the minimum application and persistence contracts**

Add the interfaces above. In `CreateUserUseCase.execute`:

1. trim and lowercase the email for `normalizedEmail`;
2. deduplicate and lexicographically sort `roleKeys`;
3. call `roles.resolve('active', roleKeys)` before hashing;
4. hash the password;
5. delegate one `UserProvisioningInput` to `AuthPersistencePort.createUser`;
6. emit only these reviewed audit tuples:

```text
user_create|success|USER_CREATED
user_create|conflict|EMAIL_ALREADY_EXISTS
user_create|denied|UNKNOWN_ROLE
user_create|denied|DEPENDENCY_UNAVAILABLE
```

Retain `UnknownRoleAssignmentError`; rethrow failures without adding secret-bearing messages.

- [ ] **Step 4: Run the application test and observe GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Write the real PostgreSQL integration test**

Create `test/integration/modules/auth/create-user.integration.spec.ts`. Start PostgreSQL, deploy migrations, connect `PrismaClientProvider`, and construct the use case through `createUserCommand` with `API_ROLE_DEFINITIONS`. Prove:

1. a roleless user has one user row, one Argon2 credential, and zero role rows;
2. a reviewer has exactly one `approval.reviewer` assignment and can authenticate through `findCredentialByNormalizedEmail`;
3. two concurrent attempts for case-insensitively identical email return exactly one `{ created: true }` and one `{ created: false }`;
4. no partial credential or role rows remain after the conflict.

- [ ] **Step 6: Run the integration test and observe RED**

Run:

```bash
PATH=/Users/denischernykh/.nvm/versions/node/v24.18.0/bin:$PATH \
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.integration.config.mjs --runInBand \
  test/integration/modules/auth/create-user.integration.spec.ts
```

Expected: FAIL because `createUserCommand` and `PrismaAuthRepository.createUser` are not implemented.

- [ ] **Step 7: Implement atomic Prisma provisioning and command composition**

Implement `PrismaAuthRepository.createUser` through the existing `TransactionPort` and one nested `client.user.create`:

```ts
data: {
  email: input.email,
  normalizedEmail: input.normalizedEmail,
  credential: { create: { passwordHash: input.passwordHash } },
  roles: {
    create: input.roleKeys.map((roleKey) => ({ roleKey })),
  },
}
```

Return `{ created: true, userId }`. Convert only Prisma `P2002` into `{ created: false }`; let other failures propagate. Do not log or retain Prisma messages.

Implement `createUserCommand` with `PrismaAuthRepository`,
`Argon2PasswordHasher`, `createAuthRoleRegistry(roleDefinitions)`, and the
supplied audit boundary. It must not import bootstrap or a business module.

- [ ] **Step 8: Run the integration test and observe GREEN**

Run the Step 6 command. Expected: PASS.

- [ ] **Step 9: Write focused failing CLI tests**

Create `test/unit/bootstrap/user/create-user.cli.spec.ts` that proves:

1. accepted email and repeated role syntax reaches `execute({ email, password, roleKeys })`;
2. a no-role user is accepted;
3. password arguments, malformed/duplicate email, malformed options, missing option values, and positional values are rejected before reading stdin;
4. passwords shorter than 12 characters never reach the use case;
5. the owned password buffer is zeroed on success and every failure;
6. duplicate email and `UnknownRoleAssignmentError` receive their exact safe public outputs;
7. thrown private errors, PHC text, credentials, and connection URLs never reach stdout/stderr.

- [ ] **Step 10: Run the CLI test and observe RED**

Run:

```bash
PATH=/Users/denischernykh/.nvm/versions/node/v24.18.0/bin:$PATH \
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.unit.config.mjs --runInBand \
  test/unit/bootstrap/user/create-user.cli.spec.ts
```

Expected: FAIL because the CLI does not exist.

- [ ] **Step 11: Implement the CLI and command composition**

Implement the exact parser/output contract above. `src/bootstrap/user/main.ts` must mirror the bounded lifecycle of `src/bootstrap/admin/main.ts`, pass `API_ROLE_DEFINITIONS` into `createUserCommand`, connect only PostgreSQL, write audit logs to stderr, close within `2_000` ms, and set `process.exitCode`.

Add:

```json
"auth:create-user": "corepack pnpm@11.15.1 run prisma:generate && tsx src/bootstrap/user/main.ts"
```

- [ ] **Step 12: Extend audit logger tests and observe GREEN**

Add the four reviewed tuples to the finite audit logger allow-list and table-driven unit tests. Run:

```bash
PATH=/Users/denischernykh/.nvm/versions/node/v24.18.0/bin:$PATH \
node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
  --config jest.unit.config.mjs --runInBand \
  test/unit/modules/auth/application/create-user.use-case.spec.ts \
  test/unit/bootstrap/user/create-user.cli.spec.ts \
  test/unit/platform/logging/auth-audit.logger.spec.ts
```

Expected: PASS.

- [ ] **Step 13: Document the operator path**

Add a concise README section after initial administrator bootstrap:

```bash
pnpm auth:create-user -- --email=requester@example.com
pnpm auth:create-user -- --email=reviewer@example.com --role=approval.reviewer
```

State that the command requires migrated PostgreSQL, reads the password from hidden/piped stdin, accepts only roles compiled into the product root, and is operational provisioning rather than HTTP registration or invitation.

- [ ] **Step 14: Run static and focused gates**

Run:

```bash
PATH=/Users/denischernykh/.nvm/versions/node/v24.18.0/bin:$PATH pnpm exec prettier --write \
  package.json README.md src/bootstrap/user src/modules/auth \
  src/platform/logging/auth-audit.logger.ts \
  test/unit/bootstrap/user \
  test/unit/modules/auth/application/create-user.use-case.spec.ts \
  test/unit/platform/logging/auth-audit.logger.spec.ts \
  test/integration/modules/auth/create-user.integration.spec.ts
PATH=/Users/denischernykh/.nvm/versions/node/v24.18.0/bin:$PATH pnpm check:quick
PATH=/Users/denischernykh/.nvm/versions/node/v24.18.0/bin:$PATH git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 15: Commit**

```bash
git add \
  package.json README.md \
  src/bootstrap/user \
  src/modules/auth/application \
  src/modules/auth/composition/user-provisioning.module.ts \
  src/modules/auth/infrastructure/prisma-auth.repository.ts \
  src/platform/logging/auth-audit.logger.ts \
  test/unit/bootstrap/user \
  test/unit/modules/auth/application/create-user.use-case.spec.ts \
  test/unit/platform/logging/auth-audit.logger.spec.ts \
  test/integration/modules/auth/create-user.integration.spec.ts \
  docs/superpowers/plans/2026-07-29-auth-create-user-cli.md
git commit -m "feat(auth): add operator user provisioning"
```
