import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const appImage =
  'ghcr.io/example/nest-js-starter@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const serviceRevision = '0123456789abcdef0123456789abcdef01234567'
const authSecret = Buffer.alloc(32, 1).toString('base64url')

const validEnvironment = {
  APP_IMAGE: appImage,
  AUTH_CSRF_SECRET: authSecret,
  AUTH_NETWORK_METADATA_SECRET: authSecret,
  AUTH_RATE_LIMIT_KEY_SECRET: authSecret,
  AUTH_SESSION_KEY_SECRET: authSecret,
  POSTGRES_ADMIN_PASSWORD: 'YWRtaW4tcGFzc3dvcmQxMjM0NTY',
  POSTGRES_MIGRATOR_PASSWORD: 'bWlncmF0b3ItcGFzc3dvcmQxMjM0',
  POSTGRES_RUNTIME_PASSWORD: 'cnVudGltZS1wYXNzd29yZDEyMzQ',
  REDIS_PASSWORD: 'cmVkaXMtcGFzc3dvcmQxMjM0NTY',
  SERVICE_REVISION: serviceRevision,
}

function runHelper(
  overrides: Record<string, string | undefined> = {},
  scenario = 'valid',
): { readonly status: number | null; readonly output: string } {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), 'nest-js-starter-production-preflight-contract-'),
  )
  const fakeDockerPath = join(temporaryDirectory, 'docker')
  writeFileSync(
    fakeDockerPath,
    `#!/usr/bin/env bash
set -eu
if [ "\${1:-}" = image ] && [ "\${2:-}" = inspect ]; then
  case "\${*: -1}" in
    *Config.Labels*)
      case "\${FAKE_DOCKER_SCENARIO}" in
        missing-label) exit 0 ;;
        label-mismatch) printf '%s\\n' 'ffffffffffffffffffffffffffffffffffffffff' ;;
        *) printf '%s\\n' '${serviceRevision}' ;;
      esac
      ;;
    *RepoDigests*)
      if [ "\${FAKE_DOCKER_SCENARIO}" = repo-digest-mismatch ]; then
        printf '%s\\n' 'ghcr.io/example/nest-js-starter@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      else
        printf '%s\\n' '${appImage}'
      fi
      ;;
  esac
fi
`,
    { encoding: 'utf8', mode: 0o700 },
  )
  chmodSync(fakeDockerPath, 0o700)

  try {
    const result = spawnSync(
      'bash',
      ['config/deployment/production-preflight.sh'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          ...validEnvironment,
          ...overrides,
          FAKE_DOCKER_SCENARIO: scenario,
          PATH: `${temporaryDirectory}:${process.env.PATH ?? ''}`,
        },
      },
    )
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

describe('production preflight helper contract', () => {
  it('accepts an exact GHCR digest and matching OCI revision', () => {
    const result = runHelper()

    expect(result.status).toBe(0)
    expect(result.output).toContain('production preflight passed')
  })

  it.each([
    ['tag', 'ghcr.io/example/nest-js-starter:0123456789abcdef'],
    ['malformed digest', 'ghcr.io/example/nest-js-starter@sha256:abc'],
    [
      'non-GHCR image',
      'docker.io/example/nest-js-starter@sha256:' + 'a'.repeat(64),
    ],
    ['uppercase revision', serviceRevision.toUpperCase()],
    ['reserved database password', 'bad@password'],
    ['reserved Redis password', 'redis/password'],
    ['malformed auth secret', 'not-canonical-base64url'],
  ])('rejects %s', (_name, value) => {
    const overrides =
      _name === 'uppercase revision'
        ? { SERVICE_REVISION: value }
        : _name === 'reserved database password'
          ? { POSTGRES_RUNTIME_PASSWORD: value }
          : _name === 'reserved Redis password'
            ? { REDIS_PASSWORD: value }
            : _name === 'malformed auth secret'
              ? { AUTH_CSRF_SECRET: value }
              : { APP_IMAGE: value }
    const result = runHelper(overrides)

    expect(result.status).not.toBe(0)
    expect(result.output).not.toContain(value)
  })

  it.each([
    ['missing OCI revision label', 'missing-label'],
    ['mismatched OCI revision label', 'label-mismatch'],
    ['mismatched pulled RepoDigest', 'repo-digest-mismatch'],
  ])('rejects %s', (_name, scenario) => {
    const result = runHelper({}, scenario)

    expect(result.status).not.toBe(0)
    expect(result.output).not.toContain(serviceRevision)
  })
})
