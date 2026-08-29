import { ApiProperty } from '@nestjs/swagger'
import { IsString, Matches } from 'class-validator'

export class SessionPathDto {
  @ApiProperty({
    type: String,
    minLength: 22,
    maxLength: 22,
    pattern: '^[A-Za-z0-9_-]{22}$',
    example: 'AbCdEfGhIjKlMnOpQrStUv',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{22}$/u)
  public sessionId!: string
}
