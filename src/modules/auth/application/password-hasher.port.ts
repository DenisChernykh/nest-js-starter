/** Safe verification result with an explicit hash-upgrade decision. */
export interface PasswordVerification {
  readonly matches: boolean
  readonly needsRehash: boolean
}

/** Password hashing boundary used by auth application services. */
export interface PasswordHasherPort {
  /** Produces a self-describing hash using the configured current policy. */
  hash(password: string): Promise<string>
  /** Verifies a password and reports whether a matching hash is outdated. */
  verify(password: string, encodedHash: string): Promise<PasswordVerification>
}
