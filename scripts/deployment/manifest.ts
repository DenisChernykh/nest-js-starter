import { readFile } from 'node:fs/promises'

import Joi from 'joi'
import type { ValidationErrorItem } from 'joi'

/** One immutable OCI image reference bound to its source revision. */
export interface DeploymentImageReference {
  readonly imageRef: string
  readonly revision: string
}

/** Non-secret release approval inputs consumed by the deployment operator. */
export interface DeploymentReleaseManifest {
  readonly schemaVersion: 1
  readonly environment: string
  readonly repository: string
  readonly candidate: DeploymentImageReference & {
    readonly workflowRunUrl: string
  }
  readonly rollback: DeploymentImageReference & {
    readonly schemaCompatibilityEvidence: string
  }
  readonly publicApiUrl: string
}

/** One redacted manifest validation issue. */
export interface DeploymentInputIssue {
  readonly path: string
  readonly rule: string
}

/**
 * Reports deployment input failures without retaining rejected values.
 */
export class DeploymentInputError extends Error {
  readonly issues: readonly DeploymentInputIssue[]

  /**
   * Creates a redacted deployment input error.
   *
   * @param issues - Field paths and failed validation rules only.
   */
  constructor(issues: readonly DeploymentInputIssue[]) {
    super('Deployment input validation failed')
    this.name = 'DeploymentInputError'
    this.issues = Object.freeze([...issues])
  }

  /** Returns a serialization that cannot expose rejected input values. */
  toJSON(): Readonly<{
    name: string
    message: string
    issues: readonly DeploymentInputIssue[]
  }> {
    return Object.freeze({
      name: this.name,
      message: this.message,
      issues: this.issues,
    })
  }
}

const imageRefPattern =
  /^ghcr\.io\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?@sha256:[0-9a-f]{64}$/u
const revisionPattern = /^[0-9a-f]{40}$/u

const imageSchema = Joi.object({
  imageRef: Joi.string().pattern(imageRefPattern).required(),
  revision: Joi.string().pattern(revisionPattern).required(),
}).unknown(false)

const manifestSchema = Joi.object({
  schemaVersion: Joi.number().valid(1).required(),
  environment: Joi.string().trim().min(1).max(64).required(),
  repository: Joi.string()
    .pattern(/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/u)
    .required(),
  candidate: imageSchema
    .keys({
      workflowRunUrl: Joi.string()
        .uri({ scheme: ['https'] })
        .required(),
    })
    .required(),
  rollback: imageSchema
    .keys({
      schemaCompatibilityEvidence: Joi.string()
        .trim()
        .min(1)
        .max(512)
        .required(),
    })
    .required(),
  publicApiUrl: Joi.string()
    .uri({ scheme: ['https'] })
    .required(),
})
  .unknown(false)
  .required()

function toIssue(detail: ValidationErrorItem): DeploymentInputIssue {
  return Object.freeze({
    path: detail.path.length === 0 ? 'manifest' : detail.path.join('.'),
    rule: detail.type,
  })
}

function inputIssue(path: string, rule: string): DeploymentInputIssue {
  return Object.freeze({ path, rule })
}

function validateCredentialFreeUrl(
  value: string,
  path: string,
): URL | DeploymentInputIssue {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.port !== '' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return inputIssue(path, 'url.credentialFreeHttps')
    }
    return url
  } catch {
    return inputIssue(path, 'url.invalid')
  }
}

/**
 * Parses one strict non-secret release manifest.
 *
 * @param input - Untrusted decoded JSON.
 * @returns A deeply frozen release manifest.
 * @throws DeploymentInputError with redacted field/rule issues only.
 */
export function parseDeploymentManifest(
  input: unknown,
): DeploymentReleaseManifest {
  const result = manifestSchema.validate(input, {
    abortEarly: false,
    allowUnknown: false,
    convert: false,
  })
  if (result.error !== undefined) {
    throw new DeploymentInputError(result.error.details.map(toIssue))
  }

  const value = result.value as DeploymentReleaseManifest
  const issues: DeploymentInputIssue[] = []
  const expectedImageRepository = `ghcr.io/${value.repository.toLowerCase()}`

  for (const [path, image] of [
    ['candidate.imageRef', value.candidate],
    ['rollback.imageRef', value.rollback],
  ] as const) {
    if (image.imageRef.split('@')[0] !== expectedImageRepository) {
      issues.push(inputIssue(path, 'image.repositoryMismatch'))
    }
  }

  if (value.candidate.imageRef === value.rollback.imageRef) {
    issues.push(inputIssue('rollback.imageRef', 'image.mustDiffer'))
  }

  const workflowUrl = validateCredentialFreeUrl(
    value.candidate.workflowRunUrl,
    'candidate.workflowRunUrl',
  )
  if (workflowUrl instanceof URL) {
    const expectedPathPrefix = `/${value.repository}/actions/runs/`
    const runId = workflowUrl.pathname.slice(expectedPathPrefix.length)
    if (
      workflowUrl.hostname !== 'github.com' ||
      !workflowUrl.pathname.startsWith(expectedPathPrefix) ||
      !/^[1-9]\d*$/u.test(runId)
    ) {
      issues.push(
        inputIssue('candidate.workflowRunUrl', 'workflow.repositoryMismatch'),
      )
    }
  } else {
    issues.push(workflowUrl)
  }

  const publicApiUrl = validateCredentialFreeUrl(
    value.publicApiUrl,
    'publicApiUrl',
  )
  if (publicApiUrl instanceof URL) {
    if (publicApiUrl.pathname !== '/') {
      issues.push(inputIssue('publicApiUrl', 'url.baseOriginRequired'))
    }
  } else {
    issues.push(publicApiUrl)
  }

  if (issues.length > 0) throw new DeploymentInputError(issues)

  const candidate = Object.freeze({ ...value.candidate })
  const rollback = Object.freeze({ ...value.rollback })
  return Object.freeze({ ...value, candidate, rollback })
}

/**
 * Loads and parses one release manifest file.
 *
 * @param path - Operator-selected JSON manifest path.
 * @returns A deeply frozen release manifest.
 * @throws DeploymentInputError when JSON or manifest validation fails.
 */
export async function readDeploymentManifest(
  path: string,
): Promise<DeploymentReleaseManifest> {
  const bytes = await readFile(path, 'utf8')
  let input: unknown
  try {
    input = JSON.parse(bytes) as unknown
  } catch {
    throw new DeploymentInputError([inputIssue('manifest', 'json.invalid')])
  }
  return parseDeploymentManifest(input)
}
