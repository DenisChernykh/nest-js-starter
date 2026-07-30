import { ApiProperty } from '@nestjs/swagger'

/** Value-free field validation issue addressed by RFC 6901 JSON Pointer. */
export class ProblemFieldErrorResponseDto {
  @ApiProperty({
    type: String,
    pattern: '^(?:|/(?:[^~/]|~0|~1)*)$',
    example: '/email',
  })
  public readonly pointer!: string

  @ApiProperty({
    type: String,
    pattern: '^[a-z][a-z0-9_]*$',
    example: 'invalid_email',
  })
  public readonly code!: string

  @ApiProperty({
    type: String,
    example: 'The field must be a valid email address.',
  })
  public readonly detail!: string
}

/** Canonical RFC 9457 problem response with stable starter identifiers. */
export class ProblemResponseDto {
  @ApiProperty({
    type: String,
    format: 'uri',
    example: 'https://nest-js-starter.invalid/problems/authentication-required',
  })
  public readonly type!: string

  @ApiProperty({ type: String, example: 'Authentication required' })
  public readonly title!: string

  @ApiProperty({ type: Number, minimum: 400, maximum: 599, example: 401 })
  public readonly status!: number

  @ApiProperty({
    type: String,
    example: 'Valid authentication is required for this request.',
  })
  public readonly detail!: string

  @ApiProperty({
    type: String,
    format: 'uri-reference',
    example: 'urn:request:01J3G1TQ9YQ7R7FQZ5P6M2K8A4',
  })
  public readonly instance!: string

  @ApiProperty({
    type: String,
    pattern: '^[A-Z][A-Z0-9_]*$',
    example: 'AUTHENTICATION_REQUIRED',
  })
  public readonly code!: string

  @ApiProperty({
    type: String,
    example: '01J3G1TQ9YQ7R7FQZ5P6M2K8A4',
  })
  public readonly requestId!: string
}

/** RFC 9457 validation problem with deterministic value-free field issues. */
export class ValidationProblemResponseDto extends ProblemResponseDto {
  @ApiProperty({ type: () => [ProblemFieldErrorResponseDto] })
  public readonly errors!: readonly ProblemFieldErrorResponseDto[]
}
