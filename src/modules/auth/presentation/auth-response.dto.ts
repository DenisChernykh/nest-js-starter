import { ApiProperty } from '@nestjs/swagger'

/** Public session identity and absolute expiry returned after login. */
export class IssuedSessionResponseDto {
  @ApiProperty({
    type: String,
    minLength: 22,
    maxLength: 22,
    pattern: '^[A-Za-z0-9_-]{22}$',
    example: 'AbCdEfGhIjKlMnOpQrStUv',
  })
  public readonly publicId!: string

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-08-20T12:00:00.000Z',
  })
  public readonly absoluteExpiresAt!: Date
}

/** Safe browser response for a newly issued session. */
export class LoginResponseDto {
  @ApiProperty({
    type: String,
    minLength: 43,
    maxLength: 43,
    pattern: '^[A-Za-z0-9_-]{43}$',
    example: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
  })
  public readonly csrfToken!: string

  @ApiProperty({ type: () => IssuedSessionResponseDto })
  public readonly session!: IssuedSessionResponseDto
}

/** Current authenticated identity projected without credential material. */
export class CurrentUserResponseDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    example: '8dc70a15-d91f-4c67-b5a6-479faa42433c',
  })
  public readonly userId!: string

  @ApiProperty({
    type: String,
    format: 'email',
    maxLength: 254,
    example: 'admin@example.com',
  })
  public readonly normalizedEmail!: string

  @ApiProperty({
    type: [String],
    example: ['admin'],
  })
  public readonly roleKeys!: readonly string[]

  @ApiProperty({
    type: [String],
    pattern: '^[a-z][a-z0-9]*(?:\\.[a-z][a-z0-9]*)+$',
    example: ['system.docs.read'],
  })
  public readonly permissions!: readonly string[]
}

/** Session-bound CSRF token returned for an authenticated browser session. */
export class CsrfTokenResponseDto {
  @ApiProperty({
    type: String,
    minLength: 43,
    maxLength: 43,
    pattern: '^[A-Za-z0-9_-]{43}$',
    example: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI',
  })
  public readonly csrfToken!: string
}

/** Outcome of a committed auth mutation and best-effort session cleanup. */
export class AuthMutationResponseDto {
  @ApiProperty({
    type: Boolean,
    example: true,
    description:
      'Whether best-effort Redis session cleanup completed after the durable mutation.',
  })
  public readonly cleanupComplete!: boolean
}

/** Safe metadata for one browser session owned by the current user. */
export class BrowserSessionResponseDto {
  @ApiProperty({
    type: String,
    minLength: 22,
    maxLength: 22,
    pattern: '^[A-Za-z0-9_-]{22}$',
    example: 'AbCdEfGhIjKlMnOpQrStUv',
  })
  public readonly publicId!: string

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-07-21T12:00:00.000Z',
  })
  public readonly createdAt!: Date

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-07-21T12:05:00.000Z',
  })
  public readonly lastSeenAt!: Date

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-08-20T12:00:00.000Z',
  })
  public readonly absoluteExpiresAt!: Date

  @ApiProperty({
    type: String,
    maxLength: 256,
    example: 'Safari on macOS',
  })
  public readonly deviceLabel!: string

  @ApiProperty({ type: Boolean, example: true })
  public readonly current!: boolean
}

/** Container returned when listing browser sessions owned by the user. */
export class SessionsResponseDto {
  @ApiProperty({ type: () => [BrowserSessionResponseDto] })
  public readonly sessions!: readonly BrowserSessionResponseDto[]
}
