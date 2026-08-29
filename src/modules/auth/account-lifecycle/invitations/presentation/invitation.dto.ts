import { ApiProperty } from '@nestjs/swagger'
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator'

export class CreateAccountInvitationRequestDto {
  @ApiProperty({
    type: [String],
    maxItems: 50,
    example: ['system.admin'],
  })
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/u, { each: true })
  public roleKeys!: string[]

  @ApiProperty({ type: String, format: 'email', maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  public email!: string
}

export class AcceptAccountInvitationRequestDto {
  @ApiProperty({ type: String, minLength: 43, maxLength: 43 })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/u)
  @MaxLength(1024)
  public token!: string

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
