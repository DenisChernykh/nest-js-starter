import { ApiProperty } from '@nestjs/swagger'

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

export class SessionsResponseDto {
  @ApiProperty({ type: () => [BrowserSessionResponseDto] })
  public readonly sessions!: readonly BrowserSessionResponseDto[]
}
