import {
  assertRuntimeProbe,
  assertSafeTemporaryDirectory,
  createComposeArgs,
  createSmokeSecrets,
  parseImageInspection,
  validateComposeProjectName,
  validateImageReference,
  waitForHttpReady,
} from '@scripts/oci/smoke-support'

describe('OCI smoke support', () => {
  it.each([
    '',
    'starter-smoke-123',
    'nest-js-starter-smoke-0',
    'nest-js-starter-smoke-123-extra',
  ])('rejects non-owned Compose project name %j', (name) => {
    expect(() => validateComposeProjectName(name)).toThrow(
      'Invalid OCI smoke Compose project name',
    )
  })

  it('accepts a process-owned Compose project name', () => {
    expect(validateComposeProjectName('nest-js-starter-smoke-123')).toBe(
      'nest-js-starter-smoke-123',
    )
  })

  it.each(['', ' ', 'latest', 'nest-js-starter:latest', '-invalid'])(
    'rejects unsafe image reference %j',
    (image) => {
      expect(() => validateImageReference(image)).toThrow(
        'Invalid OCI smoke image reference',
      )
    },
  )

  it('rejects root, home and non-owned temporary directories', () => {
    for (const path of ['/', '/Users/example', '/tmp/unrelated']) {
      expect(() =>
        assertSafeTemporaryDirectory(path, '/Users/example'),
      ).toThrow('Unsafe OCI smoke temporary directory')
    }
  })

  it('creates distinct base64url secrets without padding', () => {
    let byte = 0
    const secrets = createSmokeSecrets((size) => {
      byte += 1
      return Buffer.alloc(size, byte)
    })

    const secretValues = [
      secrets.authCsrfSecret,
      secrets.authNetworkMetadataSecret,
      secrets.authRateLimitKeySecret,
      secrets.authSessionKeySecret,
      secrets.postgresPassword,
      secrets.redisPassword,
    ]
    expect(new Set(secretValues).size).toBe(6)
    expect(
      secretValues.every((secret) => /^[A-Za-z0-9_-]{43}$/u.test(secret)),
    ).toBe(true)
  })

  it('constructs exact project-scoped Compose cleanup arguments', () => {
    expect(
      createComposeArgs(
        {
          composeFiles: [
            'docker-compose.yml',
            'test/fixtures/oci/docker-compose.image-smoke.yml',
          ],
          envFilePath: '/tmp/nest-js-starter-smoke-123-random/runtime.env',
          projectName: 'nest-js-starter-smoke-123',
        },
        ['down', '--volumes', '--remove-orphans'],
      ),
    ).toEqual([
      'compose',
      '--env-file',
      '/tmp/nest-js-starter-smoke-123-random/runtime.env',
      '--project-name',
      'nest-js-starter-smoke-123',
      '--file',
      'docker-compose.yml',
      '--file',
      'test/fixtures/oci/docker-compose.image-smoke.yml',
      'down',
      '--volumes',
      '--remove-orphans',
    ])
  })

  it('polls readiness until the endpoint returns 200', async () => {
    const statuses = [503, 503, 200]
    let now = 0

    await expect(
      waitForHttpReady('http://127.0.0.1:3000/health/ready', {
        fetch: () => {
          const status = statuses.shift()
          if (status === undefined) {
            return Promise.reject(new Error('missing test status'))
          }
          return Promise.resolve(new Response(null, { status }))
        },
        intervalMs: 10,
        now: () => now,
        sleep: (milliseconds) => {
          now += milliseconds
          return Promise.resolve()
        },
        timeoutMs: 100,
      }),
    ).resolves.toBeUndefined()
  })

  it('fails readiness after the bounded deadline', async () => {
    let now = 0

    await expect(
      waitForHttpReady('http://127.0.0.1:3000/health/ready', {
        fetch: () => Promise.reject(new Error('connection refused')),
        intervalMs: 10,
        now: () => now,
        sleep: (milliseconds) => {
          now += milliseconds
          return Promise.resolve()
        },
        timeoutMs: 20,
      }),
    ).rejects.toThrow('OCI image did not become ready within 20ms')
  })

  it('parses the required image config without accepting mutable metadata', () => {
    expect(
      parseImageInspection(
        [
          {
            Config: {
              Cmd: ['node', 'dist/bootstrap/api/main.js'],
              Labels: {
                'org.opencontainers.image.revision': '0'.repeat(40),
                'org.opencontainers.image.source':
                  'https://github.com/example/starter',
              },
              User: 'node',
            },
          },
        ],
        '0'.repeat(40),
      ),
    ).toEqual({
      cmd: ['node', 'dist/bootstrap/api/main.js'],
      revision: '0'.repeat(40),
      source: 'https://github.com/example/starter',
      user: 'node',
    })
  })

  it('rejects root, mismatched labels and forbidden runtime files', () => {
    expect(() =>
      parseImageInspection(
        [{ Config: { Cmd: ['node'], Labels: {}, User: 'root' } }],
        '0'.repeat(40),
      ),
    ).toThrow('Invalid OCI image runtime configuration')

    expect(() =>
      assertRuntimeProbe({
        devBinaries: [],
        forbiddenPaths: ['/app/src'],
        gid: 1000,
        requiredPaths: ['/app/dist'],
        uid: 1000,
      }),
    ).toThrow('Invalid OCI image runtime filesystem')

    expect(() =>
      assertRuntimeProbe({
        devBinaries: [],
        forbiddenPaths: [],
        gid: 1000,
        requiredPaths: ['/app/dist'],
        uid: 1000,
      }),
    ).toThrow('Invalid OCI image runtime filesystem')
  })

  it('accepts the complete minimal runtime filesystem', () => {
    expect(() =>
      assertRuntimeProbe({
        devBinaries: [],
        forbiddenPaths: [],
        gid: 1000,
        requiredPaths: [
          '/app/dist',
          '/app/node_modules',
          '/app/package.json',
          '/app/prisma',
          '/app/prisma.config.ts',
        ],
        uid: 1000,
      }),
    ).not.toThrow()
  })

  it('rejects a runtime image retaining bundled npm', () => {
    expect(() =>
      assertRuntimeProbe({
        devBinaries: [],
        forbiddenPaths: ['/usr/local/lib/node_modules/npm'],
        gid: 1000,
        requiredPaths: [
          '/app/dist',
          '/app/node_modules',
          '/app/package.json',
          '/app/prisma',
          '/app/prisma.config.ts',
        ],
        uid: 1000,
      }),
    ).toThrow('Invalid OCI image runtime filesystem')
  })
})
