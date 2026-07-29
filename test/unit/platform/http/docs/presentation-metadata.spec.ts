import { AuthController } from '@/modules/auth/presentation/auth.controller'
import {
  ChangePasswordRequestDto,
  LoginRequestDto,
  SessionPathDto,
} from '@/modules/auth/presentation/auth.dto'
import { APPROVAL_SELF_DECISION_FORBIDDEN_PROBLEM } from '@/modules/approval-requests/presentation/approval-request-problem.definitions'
import { ApiProblemResponses } from '@/platform/http/docs/api-problem-responses.decorator'
import { HealthController } from '@/platform/http/health/health.controller'

const metadataKeys = {
  operation: 'swagger/apiOperation',
  parameters: 'swagger/apiParameters',
  properties: 'swagger/apiModelProperties',
  propertyNames: 'swagger/apiModelPropertiesArray',
  responses: 'swagger/apiResponse',
  tags: 'swagger/apiUseTags',
} as const

interface OperationExpectation {
  readonly controller: typeof AuthController | typeof HealthController
  readonly handler: string
  readonly operationId: string
  readonly successStatus: number
  readonly responseType?: string
  readonly unavailableResponseType?: string
  readonly bodyType?: string
  readonly pathParameter?: string
  readonly security: readonly Readonly<Record<string, readonly string[]>>[]
  readonly tag: string
}

const publicSecurity = Object.freeze([])
const sessionSecurity = Object.freeze([{ sessionCookie: [] }])
const sessionAndCsrfSecurity = Object.freeze([
  { sessionCookie: [], csrfToken: [] },
])

class SameStatusProblemFixture {
  @ApiProblemResponses(
    'AUTHORIZATION_DENIED',
    APPROVAL_SELF_DECISION_FORBIDDEN_PROBLEM,
  )
  public decide(): void {}
}

const operations: readonly OperationExpectation[] = [
  {
    controller: HealthController,
    handler: 'live',
    operationId: 'healthLive',
    successStatus: 200,
    responseType: 'LivenessResponseDto',
    security: publicSecurity,
    tag: 'health',
  },
  {
    controller: HealthController,
    handler: 'startup',
    operationId: 'healthStartup',
    successStatus: 200,
    responseType: 'StartupResponseDto',
    unavailableResponseType: 'StartupResponseDto',
    security: publicSecurity,
    tag: 'health',
  },
  {
    controller: HealthController,
    handler: 'ready',
    operationId: 'healthReady',
    successStatus: 200,
    responseType: 'ReadinessResponseDto',
    unavailableResponseType: 'ReadinessResponseDto',
    security: publicSecurity,
    tag: 'health',
  },
  {
    controller: AuthController,
    handler: 'login',
    operationId: 'authLogin',
    successStatus: 200,
    responseType: 'LoginResponseDto',
    bodyType: 'LoginRequestDto',
    security: publicSecurity,
    tag: 'auth',
  },
  {
    controller: AuthController,
    handler: 'logout',
    operationId: 'authLogout',
    successStatus: 204,
    security: sessionAndCsrfSecurity,
    tag: 'auth',
  },
  {
    controller: AuthController,
    handler: 'me',
    operationId: 'authGetMe',
    successStatus: 200,
    responseType: 'CurrentUserResponseDto',
    security: sessionSecurity,
    tag: 'auth',
  },
  {
    controller: AuthController,
    handler: 'csrf',
    operationId: 'authGetCsrfToken',
    successStatus: 200,
    responseType: 'CsrfTokenResponseDto',
    security: sessionSecurity,
    tag: 'auth',
  },
  {
    controller: AuthController,
    handler: 'changePassword',
    operationId: 'authChangePassword',
    successStatus: 200,
    responseType: 'AuthMutationResponseDto',
    bodyType: 'ChangePasswordRequestDto',
    security: sessionAndCsrfSecurity,
    tag: 'auth',
  },
  {
    controller: AuthController,
    handler: 'sessions',
    operationId: 'authListSessions',
    successStatus: 200,
    responseType: 'SessionsResponseDto',
    security: sessionSecurity,
    tag: 'auth',
  },
  {
    controller: AuthController,
    handler: 'revokeSession',
    operationId: 'authRevokeSession',
    successStatus: 204,
    pathParameter: 'sessionId',
    security: sessionAndCsrfSecurity,
    tag: 'auth',
  },
  {
    controller: AuthController,
    handler: 'logoutAll',
    operationId: 'authLogoutAll',
    successStatus: 200,
    responseType: 'AuthMutationResponseDto',
    security: sessionAndCsrfSecurity,
    tag: 'auth',
  },
]

describe('HTTP presentation Swagger metadata', () => {
  it.each(operations)(
    'describes $operationId explicitly',
    ({
      controller,
      handler,
      operationId,
      successStatus,
      responseType,
      unavailableResponseType,
      bodyType,
      pathParameter,
      security,
      tag,
    }) => {
      const tags = Reflect.getMetadata(metadataKeys.tags, controller) as
        readonly string[] | undefined
      const method = controller.prototype[
        handler as keyof typeof controller.prototype
      ] as unknown as object
      const operation = Reflect.getMetadata(metadataKeys.operation, method) as
        | {
            readonly operationId?: string
            readonly security?: readonly Readonly<
              Record<string, readonly string[]>
            >[]
          }
        | undefined
      const responses = Reflect.getMetadata(metadataKeys.responses, method) as
        Readonly<Record<string, ResponseMetadata>> | undefined
      const parameters = (Reflect.getMetadata(
        metadataKeys.parameters,
        method,
      ) ?? []) as readonly ParameterMetadata[]

      expect(tags).toContain(tag)
      expect(operation?.operationId).toBe(operationId)
      expect(operation?.security).toEqual(security)

      const successResponse = responses?.[String(successStatus)]
      expect(successResponse).toBeDefined()
      if (responseType === undefined) {
        expect(successResponse?.type).toBeUndefined()
        expect(successResponse?.schema).toBeUndefined()
        expect(successResponse?.content).toBeUndefined()
      } else {
        expect(successResponse?.type?.name).toBe(responseType)
      }
      if (unavailableResponseType !== undefined) {
        expect(responses?.['503']?.type?.name).toBe(unavailableResponseType)
      }

      if (bodyType !== undefined) {
        const bodyParameter = parameters.find(
          (parameter) => parameter.in === 'body',
        )
        expect(bodyParameter).toBeDefined()
        expect(bodyParameter?.type?.name).toBe(bodyType)
      }
      if (pathParameter !== undefined) {
        const parameter = parameters.find(
          (candidate) =>
            candidate.in === 'path' && candidate.name === pathParameter,
        )
        expect(parameter?.required).toBe(true)
        expect(parameter?.schema?.['type']).toBe('string')
        expect(parameter?.schema?.['pattern']).toBe('^[A-Za-z0-9_-]{22}$')
      }

      expect(
        Object.values(responses ?? {}).some(
          (response) =>
            response.content?.['application/problem+json'] !== undefined,
        ),
      ).toBe(true)
    },
  )

  it.each([
    [LoginRequestDto, ['email', 'password']],
    [ChangePasswordRequestDto, ['currentPassword', 'newPassword']],
    [SessionPathDto, ['sessionId']],
  ] as const)('describes every property on %p explicitly', (dto, fields) => {
    const propertyNames = (Reflect.getMetadata(
      metadataKeys.propertyNames,
      dto.prototype,
    ) ?? []) as readonly string[]

    expect(propertyNames).toEqual(fields.map((field) => `:${field}`))
    for (const field of fields) {
      const property = Reflect.getMetadata(
        metadataKeys.properties,
        dto.prototype,
        field,
      ) as unknown as PropertyMetadata | undefined
      expect(property?.type).toBe(String)
      expect(typeof property?.example).toBe('string')
    }
  })

  it('retains every stable problem code declared for the same HTTP status', () => {
    const method = Reflect.get(
      SameStatusProblemFixture.prototype,
      'decide',
    ) as object
    const responses = Reflect.getMetadata(metadataKeys.responses, method) as
      Readonly<Record<string, ResponseMetadata>> | undefined
    const examples =
      responses?.['403']?.content?.['application/problem+json']?.examples

    expect(Object.keys(examples ?? {}).sort()).toEqual([
      'APPROVAL_SELF_DECISION_FORBIDDEN',
      'AUTHORIZATION_DENIED',
    ])
  })
})

interface ResponseMetadata {
  readonly type?: { readonly name?: string }
  readonly schema?: unknown
  readonly content?: Readonly<
    Record<
      string,
      {
        readonly examples?: Readonly<Record<string, unknown>>
      }
    >
  >
}

interface ParameterMetadata {
  readonly in?: string
  readonly name?: string
  readonly required?: boolean
  readonly schema?: Readonly<Record<string, unknown>>
  readonly type?: { readonly name?: string }
}

interface PropertyMetadata {
  readonly type?: unknown
  readonly example?: unknown
}
