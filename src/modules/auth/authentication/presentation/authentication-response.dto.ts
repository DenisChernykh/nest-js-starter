import { ApiProperty } from '@nestjs/swagger'

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
