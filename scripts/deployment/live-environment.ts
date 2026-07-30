import Joi from 'joi'
import type { ValidationErrorItem } from 'joi'

import { DeploymentInputError, type DeploymentInputIssue } from './manifest.js'

/** Secret-bearing apply inputs projected from the operator process environment. */
export interface DeploymentLiveEnvironment {
  readonly dokployBaseUrl: string
  readonly dokployApiKey: string
  readonly dokployApplicationId: string
  readonly dokployApplicationEnvironment: string
  readonly dokployPreviousApplicationEnvironment: string
  readonly ghcrRegistryUrl: 'https://ghcr.io'
  readonly ghcrUsername: string
  readonly ghcrPassword: string
  readonly migrationDatabaseUrl: string
  readonly runtimeDatabaseUrl: string
}

const requiredEnvironmentSchema = Joi.object({
  DOKPLOY_BASE_URL: Joi.string().required(),
  DOKPLOY_API_KEY: Joi.string().required(),
  DOKPLOY_APPLICATION_ID: Joi.string().required(),
  DOKPLOY_APPLICATION_ENV: Joi.string().required(),
  DOKPLOY_PREVIOUS_APPLICATION_ENV: Joi.string().required(),
  GHCR_REGISTRY_URL: Joi.string().valid('https://ghcr.io').required(),
  GHCR_USERNAME: Joi.string().required(),
  GHCR_PASSWORD: Joi.string().required(),
  MIGRATION_DATABASE_URL: Joi.string().required(),
  RUNTIME_DATABASE_URL: Joi.string().required(),
}).unknown(true)

interface RequiredEnvironment {
  readonly DOKPLOY_BASE_URL: string
  readonly DOKPLOY_API_KEY: string
  readonly DOKPLOY_APPLICATION_ID: string
  readonly DOKPLOY_APPLICATION_ENV: string
  readonly DOKPLOY_PREVIOUS_APPLICATION_ENV: string
  readonly GHCR_REGISTRY_URL: 'https://ghcr.io'
  readonly GHCR_USERNAME: string
  readonly GHCR_PASSWORD: string
  readonly MIGRATION_DATABASE_URL: string
  readonly RUNTIME_DATABASE_URL: string
}

function toIssue(detail: ValidationErrorItem): DeploymentInputIssue {
  return Object.freeze({
    path: detail.path.length === 0 ? 'environment' : detail.path.join('.'),
    rule: detail.type,
  })
}

function inputIssue(path: string, rule: string): DeploymentInputIssue {
  return Object.freeze({ path, rule })
}

function validateBaseUrl(value: string): DeploymentInputIssue | undefined {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.port !== '' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return inputIssue('DOKPLOY_BASE_URL', 'url.baseOriginRequired')
    }
  } catch {
    return inputIssue('DOKPLOY_BASE_URL', 'url.invalid')
  }
  return undefined
}

function findAssignments(environment: string, key: string): readonly string[] {
  return environment
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(`${key}=`))
    .map((line) => line.slice(key.length + 1))
}

/**
 * Validates and projects the live operator environment for an apply command.
 *
 * @remarks
 * The returned object owns references to secret strings only in process memory.
 * Validation failures contain field names and rules, never rejected values.
 *
 * @param input - Untrusted process environment.
 * @param revision - Candidate revision already approved by the manifest.
 * @returns A frozen projection containing only required apply inputs.
 * @throws DeploymentInputError when required values or runtime bindings differ.
 */
export function parseDeploymentLiveEnvironment(
  input: NodeJS.ProcessEnv,
  revision: string,
): DeploymentLiveEnvironment {
  const result = requiredEnvironmentSchema.validate(input, {
    abortEarly: false,
    allowUnknown: true,
    convert: false,
  })
  if (result.error !== undefined) {
    throw new DeploymentInputError(result.error.details.map(toIssue))
  }

  const value = result.value as RequiredEnvironment
  const issues: DeploymentInputIssue[] = []
  const baseUrlIssue = validateBaseUrl(value.DOKPLOY_BASE_URL)
  if (baseUrlIssue !== undefined) issues.push(baseUrlIssue)

  const databaseUrls = findAssignments(
    value.DOKPLOY_APPLICATION_ENV,
    'DATABASE_URL',
  )
  if (
    databaseUrls.length !== 1 ||
    databaseUrls[0] !== value.RUNTIME_DATABASE_URL
  ) {
    issues.push(
      inputIssue(
        'DOKPLOY_APPLICATION_ENV.DATABASE_URL',
        databaseUrls.length === 1
          ? 'environment.valueMismatch'
          : 'environment.assignmentCount',
      ),
    )
  }

  const revisions = findAssignments(
    value.DOKPLOY_APPLICATION_ENV,
    'SERVICE_REVISION',
  )
  if (revisions.length !== 1 || revisions[0] !== revision) {
    issues.push(
      inputIssue(
        'DOKPLOY_APPLICATION_ENV.SERVICE_REVISION',
        revisions.length === 1
          ? 'environment.valueMismatch'
          : 'environment.assignmentCount',
      ),
    )
  }

  if (issues.length > 0) throw new DeploymentInputError(issues)

  return Object.freeze({
    dokployBaseUrl: value.DOKPLOY_BASE_URL,
    dokployApiKey: value.DOKPLOY_API_KEY,
    dokployApplicationId: value.DOKPLOY_APPLICATION_ID,
    dokployApplicationEnvironment: value.DOKPLOY_APPLICATION_ENV,
    dokployPreviousApplicationEnvironment:
      value.DOKPLOY_PREVIOUS_APPLICATION_ENV,
    ghcrRegistryUrl: value.GHCR_REGISTRY_URL,
    ghcrUsername: value.GHCR_USERNAME,
    ghcrPassword: value.GHCR_PASSWORD,
    migrationDatabaseUrl: value.MIGRATION_DATABASE_URL,
    runtimeDatabaseUrl: value.RUNTIME_DATABASE_URL,
  })
}
