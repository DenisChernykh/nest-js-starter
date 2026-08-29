export interface ProvisioningPasswordHasherPort {
  hash(password: string): Promise<string>
}

export const PROVISIONING_PASSWORD_HASHER: unique symbol = Symbol(
  'PROVISIONING_PASSWORD_HASHER',
)
