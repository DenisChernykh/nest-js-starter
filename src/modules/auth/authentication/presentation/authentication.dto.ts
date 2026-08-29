import { ApiProperty } from '@nestjs/swagger'
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator'

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
