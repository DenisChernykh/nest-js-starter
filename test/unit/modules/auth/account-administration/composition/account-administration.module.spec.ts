import { AccountAdministrationMutations } from '@/modules/auth/account-administration/application/account-administration-mutations.service'
import { AccountAdministrationQueries } from '@/modules/auth/account-administration/application/account-administration-queries.service'
import { AccountAdministrationModule } from '@/modules/auth/account-administration/composition/account-administration.module'
import { AdminAccountController } from '@/modules/auth/account-administration/presentation/admin-account.controller'
import { AuthenticationModule } from '@/modules/auth/authentication/composition/authentication.module'
import { AuthorizationModule } from '@/modules/auth/authorization/composition/authorization.module'
import { SessionsModule } from '@/modules/auth/sessions/composition/sessions.module'

describe('AccountAdministrationModule', () => {
  it('imports the exact configured Authorization module without configuring another registry', () => {
    const authorizationModule = AuthorizationModule.forRoot([])
    const forRoot = jest.spyOn(AuthorizationModule, 'forRoot')

    const moduleDefinition =
      AccountAdministrationModule.register(authorizationModule)

    expect(moduleDefinition.imports?.[0]).toBe(authorizationModule)
    expect(moduleDefinition.imports).toEqual(
      expect.arrayContaining([authorizationModule, SessionsModule]),
    )
    expect(moduleDefinition.imports).not.toContain(AuthenticationModule)
    expect(forRoot).not.toHaveBeenCalled()
    expect(moduleDefinition.controllers).toEqual([AdminAccountController])
    expect(moduleDefinition.providers).toEqual(
      expect.arrayContaining([
        AccountAdministrationQueries,
        AccountAdministrationMutations,
      ]),
    )
    forRoot.mockRestore()
  })
})
