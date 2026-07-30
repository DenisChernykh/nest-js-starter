import { DeploymentInputError } from '@scripts/deployment/manifest'
import { parseDeploymentLiveEnvironment } from '@scripts/deployment/live-environment'

const revision = '1'.repeat(40)
const runtimeDatabaseUrl =
  'postgresql://runtime:runtime-secret@database.example.com/app?options=a=b'
const migrationDatabaseUrl =
  'postgresql://migrator:migration-secret@database.example.com/app?options=c=d'
const applicationEnvironment = [
  'NODE_ENV=production',
  `DATABASE_URL=${runtimeDatabaseUrl}`,
  `SERVICE_REVISION=${revision}`,
  'EXTERNAL_VALUE=left=middle=right',
].join('\n')
const previousApplicationEnvironment = [
  'NODE_ENV=production',
  'DATABASE_URL=postgresql://previous:secret@database.example.com/app',
  `SERVICE_REVISION=${'2'.repeat(40)}`,
].join('\n')

const validEnvironment: NodeJS.ProcessEnv = {
  DOKPLOY_BASE_URL: 'https://dokploy.example.com',
  DOKPLOY_API_KEY: 'dokploy-api-secret',
  DOKPLOY_APPLICATION_ID: 'application-id',
  DOKPLOY_APPLICATION_ENV: applicationEnvironment,
  DOKPLOY_PREVIOUS_APPLICATION_ENV: previousApplicationEnvironment,
  GHCR_REGISTRY_URL: 'https://ghcr.io',
  GHCR_USERNAME: 'registry-user',
  GHCR_PASSWORD: 'registry-secret',
  MIGRATION_DATABASE_URL: migrationDatabaseUrl,
  RUNTIME_DATABASE_URL: runtimeDatabaseUrl,
}

function captureInputError(input: NodeJS.ProcessEnv): DeploymentInputError {
  try {
    parseDeploymentLiveEnvironment(input, revision)
  } catch (error) {
    if (error instanceof DeploymentInputError) return error
    throw error
  }
  throw new Error('Expected live environment validation to fail')
}

describe('parseDeploymentLiveEnvironment', () => {
  it('projects and freezes the required live environment', () => {
    const parsed = parseDeploymentLiveEnvironment(validEnvironment, revision)

    expect(parsed).toEqual({
      dokployBaseUrl: 'https://dokploy.example.com',
      dokployApiKey: 'dokploy-api-secret',
      dokployApplicationId: 'application-id',
      dokployApplicationEnvironment: applicationEnvironment,
      dokployPreviousApplicationEnvironment: previousApplicationEnvironment,
      ghcrRegistryUrl: 'https://ghcr.io',
      ghcrUsername: 'registry-user',
      ghcrPassword: 'registry-secret',
      migrationDatabaseUrl,
      runtimeDatabaseUrl,
    })
    expect(Object.isFrozen(parsed)).toBe(true)
  })

  it.each(Object.keys(validEnvironment))('rejects a missing %s', (key) => {
    const input = { ...validEnvironment }
    delete input[key]

    expect(captureInputError(input).issues).toEqual([
      expect.objectContaining({ path: key }),
    ])
  })

  it.each([
    'http://dokploy.example.com',
    'https://operator:secret@dokploy.example.com',
    'https://dokploy.example.com/path',
  ])('rejects an unsafe DOKPLOY_BASE_URL: %s', (dokployBaseUrl) => {
    const error = captureInputError({
      ...validEnvironment,
      DOKPLOY_BASE_URL: dokployBaseUrl,
    })

    expect(error.issues).toEqual([
      expect.objectContaining({ path: 'DOKPLOY_BASE_URL' }),
    ])
  })

  it('rejects a registry URL other than canonical GHCR', () => {
    const error = captureInputError({
      ...validEnvironment,
      GHCR_REGISTRY_URL: 'https://registry.example.com',
    })

    expect(error.issues).toEqual([
      expect.objectContaining({ path: 'GHCR_REGISTRY_URL' }),
    ])
  })

  it.each([
    {
      name: 'missing DATABASE_URL',
      environment: applicationEnvironment
        .split('\n')
        .filter((line) => !line.startsWith('DATABASE_URL='))
        .join('\n'),
      path: 'DOKPLOY_APPLICATION_ENV.DATABASE_URL',
    },
    {
      name: 'duplicated DATABASE_URL',
      environment: `${applicationEnvironment}\nDATABASE_URL=${runtimeDatabaseUrl}`,
      path: 'DOKPLOY_APPLICATION_ENV.DATABASE_URL',
    },
    {
      name: 'missing SERVICE_REVISION',
      environment: applicationEnvironment
        .split('\n')
        .filter((line) => !line.startsWith('SERVICE_REVISION='))
        .join('\n'),
      path: 'DOKPLOY_APPLICATION_ENV.SERVICE_REVISION',
    },
    {
      name: 'duplicated SERVICE_REVISION',
      environment: `${applicationEnvironment}\nSERVICE_REVISION=${revision}`,
      path: 'DOKPLOY_APPLICATION_ENV.SERVICE_REVISION',
    },
  ])('rejects $name', ({ environment, path }) => {
    const error = captureInputError({
      ...validEnvironment,
      DOKPLOY_APPLICATION_ENV: environment,
    })

    expect(error.issues).toEqual([expect.objectContaining({ path })])
  })

  it('rejects a runtime database URL mismatch', () => {
    const error = captureInputError({
      ...validEnvironment,
      RUNTIME_DATABASE_URL:
        'postgresql://runtime:other-secret@database.example.com/app',
    })

    expect(error.issues).toEqual([
      expect.objectContaining({
        path: 'DOKPLOY_APPLICATION_ENV.DATABASE_URL',
      }),
    ])
  })

  it('rejects a candidate revision mismatch', () => {
    const mismatchedRevision = '3'.repeat(40)
    const error = captureInputError({
      ...validEnvironment,
      DOKPLOY_APPLICATION_ENV: applicationEnvironment.replace(
        revision,
        mismatchedRevision,
      ),
    })

    expect(error.issues).toEqual([
      expect.objectContaining({
        path: 'DOKPLOY_APPLICATION_ENV.SERVICE_REVISION',
      }),
    ])
  })

  it('never serializes secret values or complete application environments', () => {
    const input = {
      ...validEnvironment,
      GHCR_REGISTRY_URL: 'https://registry.example.com',
      DOKPLOY_APPLICATION_ENV: `${applicationEnvironment}\nDATABASE_URL=${runtimeDatabaseUrl}`,
    }
    const serialized = JSON.stringify(captureInputError(input))

    expect(serialized).not.toContain(validEnvironment.DOKPLOY_API_KEY)
    expect(serialized).not.toContain(validEnvironment.GHCR_PASSWORD)
    expect(serialized).not.toContain(migrationDatabaseUrl)
    expect(serialized).not.toContain(runtimeDatabaseUrl)
    expect(serialized).not.toContain(applicationEnvironment)
    expect(serialized).not.toContain(previousApplicationEnvironment)
  })
})
