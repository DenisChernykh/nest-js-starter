import { AccountLifecycleModule } from '@/modules/auth/account-lifecycle/composition/account-lifecycle.module'
import { ConfirmEmailVerificationUseCase } from '@/modules/auth/account-lifecycle/email-verification/application/confirm-email-verification.use-case'
import { ResendEmailVerificationUseCase } from '@/modules/auth/account-lifecycle/email-verification/application/resend-email-verification.use-case'
import { AcceptAccountInvitationUseCase } from '@/modules/auth/account-lifecycle/invitations/application/accept-account-invitation.use-case'
import { CreateAccountInvitationUseCase } from '@/modules/auth/account-lifecycle/invitations/application/create-account-invitation.use-case'
import { ResendAccountInvitationUseCase } from '@/modules/auth/account-lifecycle/invitations/application/resend-account-invitation.use-case'
import { ConfirmPasswordResetUseCase } from '@/modules/auth/account-lifecycle/password-recovery/application/confirm-password-reset.use-case'
import { RequestAdministratorPasswordResetUseCase } from '@/modules/auth/account-lifecycle/password-recovery/application/request-administrator-password-reset.use-case'
import { RequestPasswordResetUseCase } from '@/modules/auth/account-lifecycle/password-recovery/application/request-password-reset.use-case'
import { RegisterUserUseCase } from '@/modules/auth/account-lifecycle/registration/application/register-user.use-case'
import { AuthenticationModule } from '@/modules/auth/authentication/composition/authentication.module'
import { AuthorizationModule } from '@/modules/auth/authorization/composition/authorization.module'
import { SessionsModule } from '@/modules/auth/sessions/composition/sessions.module'

describe('AccountLifecycleModule', () => {
  it('imports the configured Authorization module instance supplied by root', () => {
    const authorization = AuthorizationModule.forRoot([])
    const lifecycle = AccountLifecycleModule.register(authorization)

    expect(lifecycle.imports?.[0]).toBe(authorization)
    expect(lifecycle.imports).toEqual(
      expect.arrayContaining([AuthenticationModule, SessionsModule]),
    )
    expect(lifecycle.imports).not.toContain(AuthorizationModule)
  })

  it('owns each lifecycle workflow as an explicit use case', () => {
    const lifecycle = AccountLifecycleModule.register(
      AuthorizationModule.forRoot([]),
    )

    expect(lifecycle.providers).toEqual(
      expect.arrayContaining([
        RegisterUserUseCase,
        ResendEmailVerificationUseCase,
        ConfirmEmailVerificationUseCase,
        RequestPasswordResetUseCase,
        ConfirmPasswordResetUseCase,
        CreateAccountInvitationUseCase,
        ResendAccountInvitationUseCase,
        RequestAdministratorPasswordResetUseCase,
        AcceptAccountInvitationUseCase,
      ]),
    )
    expect(lifecycle.exports).toBeUndefined()
  })
})
