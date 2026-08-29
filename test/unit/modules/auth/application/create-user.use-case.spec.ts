import { UnknownRoleAssignmentError } from '@/modules/auth/application/auth-errors'
import type { AuthAuditEvent } from '@/modules/auth/application/auth-audit.port'
import type { AccountProvisioningPort } from '@/modules/auth/application/account-provisioning.port'
import {
  CreateUserUseCase,
  type CreateUserResult,
} from '@/modules/auth/application/create-user.use-case'
import type { PasswordHasherPort } from '@/modules/auth/application/password-hasher.port'
import { definePermissions } from '@/modules/auth/application/permission'
import {
  createAuthRoleRegistry,
  type RoleDefinition,
} from '@/modules/auth/application/role-registry'

const roleDefinitions: readonly RoleDefinition[] = [
  { key: 'system.admin', permissions: definePermissions(['system.docs.read']) },
  {
    key: 'approval.reviewer',
    permissions: definePermissions(['approval.request.review']),
  },
]

interface UseCaseHarness {
  readonly auditEvents: AuthAuditEvent[]
  readonly createUser: jest.MockedFunction<
    AccountProvisioningPort['createUser']
  >
  readonly hash: jest.MockedFunction<PasswordHasherPort['hash']>
  readonly useCase: CreateUserUseCase
}

function harness(
  result: CreateUserResult = { created: true, userId: 'user-1' },
): UseCaseHarness {
  const createUser: jest.MockedFunction<AccountProvisioningPort['createUser']> =
    jest.fn().mockResolvedValue(result)
  const hash: jest.MockedFunction<PasswordHasherPort['hash']> = jest
    .fn()
    .mockResolvedValue('$argon2id$reviewed-hash')
  const auditEvents: AuthAuditEvent[] = []
  const persistence = {
    createUser,
  } as unknown as AccountProvisioningPort
  const passwords: PasswordHasherPort = {
    hash,
    verify: () => Promise.resolve({ matches: false, needsRehash: false }),
  }
  const useCase = new CreateUserUseCase(
    persistence,
    passwords,
    createAuthRoleRegistry(roleDefinitions),
    { emit: (event) => auditEvents.push(event) },
  )
  return { auditEvents, createUser, hash, useCase }
}

describe('CreateUserUseCase', () => {
  it('normalizes email and persists unique roles in lexicographic order', async () => {
    const { createUser, useCase } = harness()

    await expect(
      useCase.execute({
        email: '  Admin@Example.com  ',
        password: 'a reviewed password',
        roleKeys: ['system.admin', 'approval.reviewer', 'approval.reviewer'],
      }),
    ).resolves.toEqual({ created: true, userId: 'user-1' })

    const input = createUser.mock.calls[0]?.[0]
    expect(input).toMatchObject({
      email: 'Admin@Example.com',
      normalizedEmail: 'admin@example.com',
      passwordHash: '$argon2id$reviewed-hash',
      roleKeys: ['approval.reviewer', 'system.admin'],
    })
    expect(input?.emailVerifiedAt).toBeInstanceOf(Date)
  })

  it('hashes a password and returns the repository result', async () => {
    const { hash, useCase } = harness({ created: false })

    await expect(
      useCase.execute({
        email: 'reviewer@example.com',
        password: 'a reviewed password',
        roleKeys: ['approval.reviewer'],
      }),
    ).resolves.toEqual({ created: false })
    expect(hash).toHaveBeenCalledWith('a reviewed password')
  })

  it('rejects an unknown role before hashing or persistence', async () => {
    const { createUser, hash, useCase } = harness()

    await expect(
      useCase.execute({
        email: 'reviewer@example.com',
        password: 'a reviewed password',
        roleKeys: ['approval.unknown'],
      }),
    ).rejects.toBeInstanceOf(UnknownRoleAssignmentError)
    expect(hash).not.toHaveBeenCalled()
    expect(createUser).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'success',
      result: { created: true, userId: 'user-1' } as const,
      event: {
        action: 'user_create',
        outcome: 'success',
        reasonCode: 'USER_CREATED',
      },
    },
    {
      name: 'duplicate email',
      result: { created: false } as const,
      event: {
        action: 'user_create',
        outcome: 'conflict',
        reasonCode: 'EMAIL_ALREADY_EXISTS',
      },
    },
  ])('emits the value-free $name audit event', async ({ event, result }) => {
    const { auditEvents, useCase } = harness(result)

    await useCase.execute({
      email: 'reviewer@example.com',
      password: 'a reviewed password',
      roleKeys: ['approval.reviewer'],
    })

    expect(auditEvents).toEqual([event])
  })

  it('emits the value-free unknown-role audit event', async () => {
    const { auditEvents, useCase } = harness()

    await expect(
      useCase.execute({
        email: 'reviewer@example.com',
        password: 'a reviewed password',
        roleKeys: ['approval.unknown'],
      }),
    ).rejects.toBeInstanceOf(UnknownRoleAssignmentError)
    expect(auditEvents).toEqual([
      {
        action: 'user_create',
        outcome: 'denied',
        reasonCode: 'UNKNOWN_ROLE',
      },
    ])
  })

  it('emits the value-free dependency-failure audit event and rethrows', async () => {
    const { auditEvents, createUser, useCase } = harness()
    const failure = new Error('private database failure')
    createUser.mockRejectedValueOnce(failure)

    await expect(
      useCase.execute({
        email: 'reviewer@example.com',
        password: 'a reviewed password',
        roleKeys: ['approval.reviewer'],
      }),
    ).rejects.toBe(failure)
    expect(auditEvents).toEqual([
      {
        action: 'user_create',
        outcome: 'denied',
        reasonCode: 'DEPENDENCY_UNAVAILABLE',
      },
    ])
  })
})
