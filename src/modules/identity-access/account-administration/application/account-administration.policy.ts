export interface AccountAdministrationPolicy {
  readonly mode: 'disabled' | 'enabled'
}

export const ACCOUNT_ADMINISTRATION_POLICY: unique symbol = Symbol(
  'ACCOUNT_ADMINISTRATION_POLICY',
)
