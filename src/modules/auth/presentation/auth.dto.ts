import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator'

/** Strict credential payload accepted by the browser login endpoint. */
export class LoginRequestDto {
  @IsEmail()
  @MaxLength(254)
  public email!: string

  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  public password!: string
}

/** Strict current/new credential payload for an authenticated account. */
export class ChangePasswordRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  public currentPassword!: string

  @IsString()
  @MinLength(12)
  @MaxLength(1024)
  public newPassword!: string
}

/** Canonical public session identifier accepted from an owned route path. */
export class SessionPathDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{22}$/u)
  public sessionId!: string
}

/** Safe browser response for a newly issued session. */
export interface LoginResponseDto {
  readonly csrfToken: string
  readonly session: {
    readonly publicId: string
    readonly absoluteExpiresAt: Date
  }
}
