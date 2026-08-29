export interface AuthMailDeliveryPort {
  sendEmailVerification(input: {
    readonly to: string
    readonly verificationUrl: string
  }): Promise<{ readonly delivered: boolean }>
  sendPasswordReset(input: {
    readonly to: string
    readonly resetUrl: string
  }): Promise<{ readonly delivered: boolean }>
  sendAccountInvitation(input: {
    readonly to: string
    readonly invitationUrl: string
  }): Promise<{ readonly delivered: boolean }>
}

export const AUTH_MAIL_DELIVERY: unique symbol = Symbol('AUTH_MAIL_DELIVERY')

export class AuthMailDeliveryError extends Error {
  public constructor() {
    super('Authentication email delivery failed')
    this.name = 'AuthMailDeliveryError'
  }
}
