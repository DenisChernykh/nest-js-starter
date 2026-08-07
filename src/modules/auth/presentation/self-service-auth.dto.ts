import { ApiProperty } from '@nestjs/swagger'
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator'

export class SelfServiceEmailRequestDto {
  @ApiProperty({
    type: String,
    format: 'email',
    maxLength: 254,
    example: 'user@example.com',
  })
  @IsEmail()
  @MaxLength(254)
  public email!: string
}

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

export class ConfirmEmailVerificationRequestDto {
  @ApiProperty({
    type: String,
    minLength: 43,
    maxLength: 43,
    pattern: '^[A-Za-z0-9_-]{43}$',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/u)
  public token!: string
}

export class ConfirmPasswordResetRequestDto extends ConfirmEmailVerificationRequestDto {
  @ApiProperty({
    type: String,
    format: 'password',
    minLength: 12,
    maxLength: 1024,
  })
  @IsString()
  @MinLength(12)
  @MaxLength(1024)
  public newPassword!: string
}
