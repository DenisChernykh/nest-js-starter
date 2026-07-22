import { ApiProperty } from '@nestjs/swagger'

/** Process liveness response returned while the HTTP process can serve. */
export class LivenessResponseDto {
  @ApiProperty({ type: String, enum: ['ok'], example: 'ok' })
  public readonly status!: 'ok'
}

/** Irreversible startup-latch state exposed to infrastructure probes. */
export class StartupResponseDto {
  @ApiProperty({
    type: String,
    enum: ['ok', 'starting', 'unavailable'],
    example: 'ok',
  })
  public readonly status!: 'ok' | 'starting' | 'unavailable'
}

/** Bounded readiness result with an extensible dependency-check map. */
export class ReadinessResponseDto {
  @ApiProperty({
    type: String,
    enum: ['ok', 'unavailable'],
    example: 'ok',
  })
  public readonly status!: 'ok' | 'unavailable'

  @ApiProperty({
    type: 'object',
    additionalProperties: {
      type: 'string',
      enum: ['up', 'down', 'skipped'],
    },
    example: { postgres: 'up', redis: 'up' },
    description:
      'Extensible map of registered dependency names to their bounded check status.',
  })
  public readonly checks!: Readonly<Record<string, 'up' | 'down' | 'skipped'>>
}
