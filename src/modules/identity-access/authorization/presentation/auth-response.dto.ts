import { ApiProperty } from '@nestjs/swagger'

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
