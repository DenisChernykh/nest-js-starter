import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

/** Strict credential payload accepted by the browser login endpoint. */
export class LoginRequestDto {
  @ApiProperty({
    type: String,
    format: 'email',
    maxLength: 254,
    example: 'admin@example.com',
  })
  @IsEmail()
  @MaxLength(254)
  public email!: string

  @ApiProperty({
    type: String,
    format: 'password',
    minLength: 1,
    maxLength: 1024,
    example: 'correct horse battery staple',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  public password!: string
}

/** Strict current/new credential payload for an authenticated account. */
export class ChangePasswordRequestDto {
  @ApiProperty({
    type: String,
    format: 'password',
    minLength: 1,
    maxLength: 1024,
    example: 'current correct horse battery staple',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  public currentPassword!: string

  @ApiProperty({
    type: String,
    format: 'password',
    minLength: 12,
    maxLength: 1024,
    example: 'new correct horse battery staple',
  })
  @IsString()
  @MinLength(12)
  @MaxLength(1024)
  public newPassword!: string
}

/** Canonical public session identifier accepted from an owned route path. */
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
