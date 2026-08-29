import { ApiProperty } from '@nestjs/swagger'

export class AuthMutationResponseDto {
  @ApiProperty({
    type: Boolean,
    example: true,
    description:
      'Whether best-effort Redis session cleanup completed after the durable mutation.',
  })
  public readonly cleanupComplete!: boolean
}
