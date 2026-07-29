import { applyDecorators } from '@nestjs/common'
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger'

import {
  getProblemDefinition,
  type CoreProblemCode,
} from '../errors/problem-registry'
import type { RegisteredProblemDefinition } from '../errors/problem.contracts'
import {
  ProblemResponseDto,
  ValidationProblemResponseDto,
} from './problem-response.dto'

const problemContentType = 'application/problem+json'

/**
 * Documents registered RFC 9457 failures for one controller or operation.
 *
 * @param problems - Core codes or registered module definitions that the
 * decorated boundary may emit.
 * @returns Combined Swagger response and model decorators.
 */
export function ApiProblemResponses(
  ...problems: readonly (CoreProblemCode | RegisteredProblemDefinition)[]
): ClassDecorator & MethodDecorator {
  const definitionsByStatus = new Map<number, RegisteredProblemDefinition[]>()
  for (const problem of problems) {
    const definition =
      typeof problem === 'string' ? getProblemDefinition(problem) : problem
    const definitions = definitionsByStatus.get(definition.status) ?? []
    definitions.push(definition)
    definitionsByStatus.set(definition.status, definitions)
  }
  const responseDecorators = [...definitionsByStatus].map(
    ([status, definitions]) => {
      const responseTypes = [
        ...new Set(
          definitions.map(({ code }) =>
            code === 'VALIDATION_FAILED'
              ? ValidationProblemResponseDto
              : ProblemResponseDto,
          ),
        ),
      ]
      const schemas = responseTypes.map((responseType) => ({
        $ref: getSchemaPath(responseType),
      }))
      const examples = Object.fromEntries(
        definitions.map((definition) => [
          definition.code,
          {
            summary: definition.title,
            value: problemExample(definition),
          },
        ]),
      )

      return ApiResponse({
        status,
        description: definitions.map(({ title }) => title).join('; '),
        content: {
          [problemContentType]: {
            schema: schemas.length === 1 ? schemas[0]! : { oneOf: schemas },
            examples,
          },
        },
      })
    },
  )

  return applyDecorators(
    ApiExtraModels(ProblemResponseDto, ValidationProblemResponseDto),
    ...responseDecorators,
  )
}

function problemExample(definition: RegisteredProblemDefinition): object {
  return {
    type: definition.type,
    title: definition.title,
    status: definition.status,
    detail: definition.detail,
    instance: 'urn:request:01J3G1TQ9YQ7R7FQZ5P6M2K8A4',
    code: definition.code,
    requestId: '01J3G1TQ9YQ7R7FQZ5P6M2K8A4',
    ...(definition.code === 'VALIDATION_FAILED'
      ? {
          errors: [
            {
              pointer: '/email',
              code: 'invalid_email',
              detail: 'The field must be a valid email address.',
            },
          ],
        }
      : {}),
  }
}
