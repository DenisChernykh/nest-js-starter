export interface IssuedOneTimeToken {
  readonly rawToken: string
  readonly digest: string
}

export interface OneTimeTokenCodecPort {
  issue(): IssuedOneTimeToken
  digest(rawToken: string): string | undefined
}

export const ONE_TIME_TOKEN_CODEC: unique symbol = Symbol(
  'ONE_TIME_TOKEN_CODEC',
)
