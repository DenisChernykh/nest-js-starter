import { ApiProperty } from '@nestjs/swagger'
import { IsString, MaxLength, MinLength } from 'class-validator'

import { SelfServiceEmailRequestDto } from '../../presentation/self-service-email-request.dto'

export class RegisterUserRequestDto extends SelfServiceEmailRequestDto {
  @ApiProperty({
    type: String,
    format: 'password',
    minLength: 12,
    maxLength: 1024,
  })
  @IsString()
  @MinLength(12)
  @MaxLength(1024)
  public password!: string
}
