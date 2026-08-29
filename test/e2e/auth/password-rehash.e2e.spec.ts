import { argon2id, hash as argon2Hash } from 'argon2'

import { Argon2PasswordHasher } from '@/modules/auth/authentication/infrastructure/argon2-password.hasher'
import {
  createAuthTestRuntime,
  type AuthE2eRuntime,
} from '@test/e2e/support/create-auth-test-runtime'

async function login(
  baseUrl: string,
  email: string,
  password: string,
): Promise<Response> {
  return fetch(`${baseUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ email, password }),
  })
}

describe('Argon2id login rehash', () => {
  let runtime: AuthE2eRuntime
  let baseUrl: string
  let weakHash: string

  beforeAll(async () => {
    runtime = await createAuthTestRuntime(1)
    baseUrl = runtime.instances[0]?.baseUrl ?? ''
    const encoded: unknown = await argon2Hash('valid password', {
      type: argon2id,
      memoryCost: 4_096,
      timeCost: 1,
      parallelism: 1,
      hashLength: 16,
    })
    if (typeof encoded !== 'string') throw new Error('Weak hash fixture failed')
    weakHash = encoded
  })

  beforeEach(async () => runtime.flushRedis())
  afterAll(async () => runtime.stop())

  it('upgrades a weak hash after successful verification', async () => {
    const userId = await runtime.createUser('rehash@example.com', weakHash)

    expect(
      (await login(baseUrl, 'rehash@example.com', 'valid password')).status,
    ).toBe(200)
    const result = await runtime.pool.query<{
      password_hash: string
      version: number
    }>(
      'SELECT password_hash, version FROM password_credentials WHERE user_id = $1',
      [userId],
    )
    const credential = result.rows[0]
    expect(credential?.password_hash).not.toBe(weakHash)
    expect(credential?.version).toBe(1)
    await expect(
      new Argon2PasswordHasher().verify(
        'valid password',
        credential?.password_hash ?? '',
      ),
    ).resolves.toEqual({ matches: true, needsRehash: false })
  })

  it('does not upgrade after a wrong password', async () => {
    const userId = await runtime.createUser(
      'wrong-rehash@example.com',
      weakHash,
    )

    expect(
      (await login(baseUrl, 'wrong-rehash@example.com', 'wrong password'))
        .status,
    ).toBe(401)
    const result = await runtime.pool.query<{
      password_hash: string
      version: number
    }>(
      'SELECT password_hash, version FROM password_credentials WHERE user_id = $1',
      [userId],
    )
    expect(result.rows[0]).toEqual({ password_hash: weakHash, version: 0 })
  })
})
