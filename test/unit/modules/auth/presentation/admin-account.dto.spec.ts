import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { AcceptAccountInvitationRequestDto } from '@/modules/auth/presentation/admin-account.dto'

describe('AcceptAccountInvitationRequestDto', () => {
  it('accepts one canonical token and a valid password', async () => {
    const dto = plainToInstance(AcceptAccountInvitationRequestDto, {
      token: 'A'.repeat(43),
      password: 'a sufficiently long password',
    })

    await expect(validate(dto)).resolves.toEqual([])
  })

  it.each(['short', 'A'.repeat(42), `${'A'.repeat(42)}=`, 'A'.repeat(44)])(
    'rejects a non-canonical invitation token: %s',
    async (token) => {
      const dto = plainToInstance(AcceptAccountInvitationRequestDto, {
        token,
        password: 'a sufficiently long password',
      })

      await expect(validate(dto)).resolves.not.toEqual([])
    },
  )
})
