import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const httpMethods = new Set([
  'delete',
  'get',
  'head',
  'options',
  'patch',
  'post',
  'put',
  'trace',
])
const pathItemFields = new Set([
  '$ref',
  'description',
  'parameters',
  'servers',
  'summary',
  ...httpMethods,
])
const stableOperationId = /^[a-z][A-Za-z0-9]*$/u

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasStringMembers(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((member) => typeof member === 'string' && member.length > 0)
  )
}

function hasSecurityRequirements(value: unknown): value is readonly unknown[] {
  return (
    Array.isArray(value) &&
    value.every(
      (requirement) =>
        isRecord(requirement) &&
        Object.values(requirement).every((scopes) => Array.isArray(scopes)),
    )
  )
}

/**
 * Enforces stable operation identity and explicit structural documentation.
 *
 * @param document - Parsed untrusted OpenAPI document.
 * @throws Error when path items or operation metadata are incomplete/unstable.
 */
export function assertOpenApiOperations(document: unknown): void {
  const issues: string[] = []
  const operationIds = new Set<string>()
  if (!isRecord(document) || !isRecord(document['paths'])) {
    throw new Error('Invalid OpenAPI operation contract: paths')
  }

  for (const [path, pathItemValue] of Object.entries(document['paths'])) {
    if (!path.startsWith('/') || !isRecord(pathItemValue)) {
      issues.push(`${path}:path-item`)
      continue
    }
    const unknownFields = Object.keys(pathItemValue).filter(
      (field) => !pathItemFields.has(field),
    )
    if (unknownFields.length > 0) issues.push(`${path}:path-item-fields`)

    const operations = Object.entries(pathItemValue).filter(([field]) =>
      httpMethods.has(field),
    )
    if (operations.length === 0) issues.push(`${path}:operations`)

    for (const [method, operationValue] of operations) {
      const location = `${method.toUpperCase()} ${path}`
      if (!isRecord(operationValue)) {
        issues.push(`${location}:object`)
        continue
      }
      const operationId = operationValue['operationId']
      if (
        typeof operationId !== 'string' ||
        !stableOperationId.test(operationId) ||
        operationIds.has(operationId)
      ) {
        issues.push(`${location}:operationId`)
      } else {
        operationIds.add(operationId)
      }
      if (
        typeof operationValue['summary'] !== 'string' ||
        operationValue['summary'].trim() === ''
      ) {
        issues.push(`${location}:summary`)
      }
      if (!hasStringMembers(operationValue['tags'])) {
        issues.push(`${location}:tags`)
      }
      if (
        !isRecord(operationValue['responses']) ||
        Object.keys(operationValue['responses']).length === 0
      ) {
        issues.push(`${location}:responses`)
      }
      if (!hasSecurityRequirements(operationValue['security'])) {
        issues.push(`${location}:security`)
      }
    }
  }

  if (issues.length > 0) {
    throw new Error(
      `Invalid OpenAPI operation contract: ${issues.sort().join(', ')}`,
    )
  }
}

/** Reads and validates operation metadata from one local OpenAPI artifact. */
export async function checkOpenApiOperations(
  artifactPath = 'docs/api/openapi.json',
): Promise<void> {
  const text = await readFile(resolve(artifactPath), 'utf8')
  assertOpenApiOperations(JSON.parse(text) as unknown)
}

async function main(): Promise<void> {
  await checkOpenApiOperations()
  process.stdout.write('OpenAPI operations: valid\n')
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(__filename)
) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'OpenAPI failed'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
