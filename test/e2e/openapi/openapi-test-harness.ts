import { readFile } from 'node:fs/promises'

import OpenAPIResponseValidator, {
  type OpenAPIResponseValidatorArgs,
} from 'openapi-response-validator'
import type { Response } from 'supertest'

const methods = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const

/** Minimal schema fields inspected by the committed-contract tests. */
export interface CommittedOpenApiSchema {
  readonly $ref?: string
  readonly enum?: readonly unknown[]
  readonly properties?: Readonly<Record<string, CommittedOpenApiSchema>>
  readonly [key: string]: unknown
}

interface CommittedOpenApiMediaType {
  readonly schema?: CommittedOpenApiSchema
}

interface CommittedOpenApiResponse {
  readonly description?: string
  readonly content?: Readonly<Record<string, CommittedOpenApiMediaType>>
}

interface CommittedOpenApiOperation {
  readonly operationId?: string
  readonly responses: Readonly<
    Record<string, CommittedOpenApiResponse | { readonly $ref: string }>
  >
}

type CommittedOpenApiPathItem = Partial<
  Readonly<Record<(typeof methods)[number], CommittedOpenApiOperation>>
>

/** Minimal immutable view of the committed OpenAPI JSON artifact. */
export interface CommittedOpenApiDocument {
  readonly openapi: '3.0.3'
  readonly paths: Readonly<Record<string, CommittedOpenApiPathItem>>
  readonly components?: {
    readonly schemas?: Readonly<Record<string, CommittedOpenApiSchema>>
    readonly [key: string]: unknown
  }
}

type ValidationDefinition =
  | {
      readonly kind: 'response'
      readonly value: CommittedOpenApiResponse
    }
  | { readonly kind: 'schema'; readonly value: CommittedOpenApiSchema }

let committedDocument: Promise<CommittedOpenApiDocument> | undefined

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function mediaType(response: Response): string | undefined {
  const header = response.headers['content-type']
  return typeof header === 'string'
    ? header.split(';', 1)[0]?.trim().toLowerCase()
    : undefined
}

function findOperation(
  document: CommittedOpenApiDocument,
  operationId: string,
): CommittedOpenApiOperation {
  for (const pathItem of Object.values(document.paths)) {
    for (const method of methods) {
      const operation = pathItem[method]
      if (operation?.operationId === operationId) return operation
    }
  }
  throw new Error(`OpenAPI operation is unavailable: ${operationId}`)
}

function responseObject(
  operation: CommittedOpenApiOperation,
  status: number,
): CommittedOpenApiResponse {
  const definition = operation.responses[String(status)]
  if (definition === undefined) {
    throw new Error(`OpenAPI response status is unavailable: ${status}`)
  }
  if ('$ref' in definition) {
    throw new Error(
      'Referenced OpenAPI responses are not supported by the harness',
    )
  }
  return definition
}

function createValidator(
  document: CommittedOpenApiDocument,
  status: number,
  definition: ValidationDefinition,
): OpenAPIResponseValidator {
  const response =
    definition.kind === 'response'
      ? definition.value
      : { schema: definition.value }
  const args = {
    responses: { [String(status)]: response },
    ...(document.components === undefined
      ? {}
      : { components: document.components }),
    customFormats: {
      'date-time': (value: string): boolean =>
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
          value,
        ) && !Number.isNaN(Date.parse(value)),
    },
  } as unknown as OpenAPIResponseValidatorArgs
  return new OpenAPIResponseValidator(args)
}

function validate(
  validator: OpenAPIResponseValidator,
  status: number,
  body: unknown,
): void {
  const error = validator.validateResponse(String(status), body)
  if (error !== undefined) {
    throw new Error(
      `OpenAPI response validation failed: ${JSON.stringify(error)}`,
    )
  }
}

/** Reads and minimally validates the committed canonical OpenAPI document. */
export function readCommittedOpenApiDocument(): Promise<CommittedOpenApiDocument> {
  committedDocument ??= readFile('docs/api/openapi.json', 'utf8').then(
    (text) => {
      const parsed: unknown = JSON.parse(text)
      if (
        !isObject(parsed) ||
        parsed['openapi'] !== '3.0.3' ||
        !isObject(parsed['paths'])
      ) {
        throw new Error('Committed OpenAPI document is invalid')
      }
      return parsed as unknown as CommittedOpenApiDocument
    },
  )
  return committedDocument
}

/**
 * Validates one real response against its operation, status and media schema.
 *
 * @param operationId - Stable committed operation identifier.
 * @param response - Real Supertest response returned by the Nest transport.
 */
export async function assertOpenApiResponseConforms(
  operationId: string,
  response: Response,
): Promise<void> {
  const document = await readCommittedOpenApiDocument()
  const definition = responseObject(
    findOperation(document, operationId),
    response.status,
  )
  const content = definition.content ?? {}
  const declaredMediaTypes = Object.keys(content)
  let body: unknown

  if (declaredMediaTypes.length === 0) {
    if ((response.text ?? '') !== '') {
      throw new Error('OpenAPI no-content response returned a body')
    }
    body = undefined
  } else {
    const actualMediaType = mediaType(response)
    if (
      actualMediaType === undefined ||
      !Object.hasOwn(content, actualMediaType)
    ) {
      throw new Error('OpenAPI response media type is not declared')
    }
    body = actualMediaType.endsWith('json') ? response.body : response.text
  }

  validate(
    createValidator(document, response.status, {
      kind: 'response',
      value: definition,
    }),
    response.status,
    body,
  )
}

/**
 * Validates a real RFC 9457 response against the committed problem component.
 *
 * @param response - Real Supertest problem response.
 */
export async function assertProblemResponseConforms(
  response: Response,
): Promise<void> {
  if (mediaType(response) !== 'application/problem+json') {
    throw new Error(
      'Problem response media type is not application/problem+json',
    )
  }
  const body: unknown = response.body
  if (!isObject(body) || body['status'] !== response.status) {
    throw new Error('Problem response status is inconsistent')
  }
  const document = await readCommittedOpenApiDocument()
  const schemaName =
    body['code'] === 'VALIDATION_FAILED'
      ? 'ValidationProblemResponseDto'
      : 'ProblemResponseDto'
  const schema = document.components?.schemas?.[schemaName]
  if (schema === undefined || schema.$ref !== undefined) {
    throw new Error(`OpenAPI problem component is unavailable: ${schemaName}`)
  }
  validate(
    createValidator(document, response.status, {
      kind: 'schema',
      value: schema,
    }),
    response.status,
    body,
  )
}
