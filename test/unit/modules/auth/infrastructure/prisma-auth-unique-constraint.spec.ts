import { Prisma } from '@/generated/prisma/client'
import { isNormalizedEmailUniqueConflict } from '@/modules/auth/infrastructure/prisma-auth-unique-constraint'

describe('Prisma auth normalized-email unique conflict', () => {
  for (const target of [['normalizedEmail'], ['normalized_email']]) {
    it(
      'accepts the normalized-email field-array target ' +
        JSON.stringify(target),
      () => {
        expect(isNormalizedEmailUniqueConflict(p2002(target))).toBe(true)
      },
    )
  }

  it('accepts the exact users normalized-email constraint name', () => {
    expect(
      isNormalizedEmailUniqueConflict(p2002('users_normalized_email_key')),
    ).toBe(true)
  })

  for (const constraint of [
    [{ fields: ['normalized_email'] }],
    [{ index: 'users_normalized_email_key' }],
  ].flat()) {
    it(
      'accepts the driver-adapter constraint ' + JSON.stringify(constraint),
      () => {
        expect(
          isNormalizedEmailUniqueConflict(driverAdapterP2002(constraint)),
        ).toBe(true)
      },
    )
  }

  const rejectedTargets: ReadonlyArray<readonly [string, unknown]> = [
    ['email-verification token field', ['tokenDigest']],
    ['email-verification token column', ['token_digest']],
    ['role primary-key fields', ['userId', 'roleKey']],
    ['role primary-key columns', ['user_id', 'role_key']],
    [
      'email-verification token constraint',
      'email_verification_tokens_token_digest_key',
    ],
    [
      'invitation token constraint',
      'account_invitation_tokens_token_digest_key',
    ],
    ['role primary-key constraint', 'user_roles_pkey'],
    ['unknown field', ['email']],
    ['unknown constraint', 'users_email_key'],
    [
      'composite target containing normalized email',
      ['normalizedEmail', 'email'],
    ],
  ]
  for (const [description, target] of rejectedTargets) {
    it('rejects the ' + description + ' target', () => {
      expect(isNormalizedEmailUniqueConflict(p2002(target))).toBe(false)
    })
  }

  const rejectedErrors: ReadonlyArray<readonly [string, unknown]> = [
    ['missing metadata', p2002()],
    ['missing target', p2002(undefined, true)],
    ['unknown target representation', p2002({ fields: ['normalizedEmail'] })],
    [
      'a different Prisma error code',
      knownRequestError('P2003', ['normalizedEmail']),
    ],
    ['a non-Prisma error', new Error('P2002')],
  ]
  for (const [description, error] of rejectedErrors) {
    it('rejects ' + description, () => {
      expect(isNormalizedEmailUniqueConflict(error)).toBe(false)
    })
  }

  const rejectedDriverConstraints: ReadonlyArray<readonly [string, unknown]> = [
    ['token fields', { fields: ['token_digest'] }],
    ['role fields', { fields: ['user_id', 'role_key'] }],
    [
      'token constraint',
      { index: 'account_invitation_tokens_token_digest_key' },
    ],
    ['role constraint', { index: 'user_roles_pkey' }],
    ['missing constraint', undefined],
    ['unknown constraint shape', { name: 'users_normalized_email_key' }],
    [
      'ambiguous constraint shape',
      {
        fields: ['normalized_email'],
        index: 'users_normalized_email_key',
      },
    ],
  ]
  for (const [description, constraint] of rejectedDriverConstraints) {
    it('rejects the driver-adapter ' + description, () => {
      expect(
        isNormalizedEmailUniqueConflict(driverAdapterP2002(constraint)),
      ).toBe(false)
    })
  }

  it('rejects a driver-adapter error with a different cause kind', () => {
    expect(
      isNormalizedEmailUniqueConflict(
        driverAdapterP2002(
          { fields: ['normalized_email'] },
          'NullConstraintViolation',
        ),
      ),
    ).toBe(false)
  })

  it('rejects conflicting direct and driver-adapter targets', () => {
    expect(
      isNormalizedEmailUniqueConflict(
        knownRequestError('P2002', ['tokenDigest'], true, {
          kind: 'UniqueConstraintViolation',
          constraint: { fields: ['normalized_email'] },
        }),
      ),
    ).toBe(false)
  })

  it('rejects a normalized direct target with a conflicting driver target', () => {
    expect(
      isNormalizedEmailUniqueConflict(
        knownRequestError('P2002', ['normalizedEmail'], true, {
          kind: 'UniqueConstraintViolation',
          constraint: {
            index: 'account_invitation_tokens_token_digest_key',
          },
        }),
      ),
    ).toBe(false)
  })

  it('accepts matching direct and driver-adapter normalized targets', () => {
    expect(
      isNormalizedEmailUniqueConflict(
        knownRequestError('P2002', ['normalizedEmail'], true, {
          kind: 'UniqueConstraintViolation',
          constraint: { fields: ['normalized_email'] },
        }),
      ),
    ).toBe(true)
  })
})

function p2002(target?: unknown, includeTarget = false): Error {
  return knownRequestError(
    'P2002',
    target,
    target !== undefined || includeTarget,
  )
}

function knownRequestError(
  code: string,
  target?: unknown,
  includeTarget = target !== undefined,
  driverCause?: Record<string, unknown>,
): Error {
  const meta: Record<string, unknown> = {}
  if (includeTarget) meta.target = target
  if (driverCause !== undefined)
    meta.driverAdapterError = { cause: driverCause }

  return new Prisma.PrismaClientKnownRequestError('private database details', {
    code,
    clientVersion: '7.9.0',
    ...(Object.keys(meta).length === 0 ? {} : { meta }),
  })
}

function driverAdapterP2002(
  constraint: unknown,
  kind = 'UniqueConstraintViolation',
): Error {
  return knownRequestError('P2002', undefined, false, {
    kind,
    ...(constraint === undefined ? {} : { constraint }),
  })
}
