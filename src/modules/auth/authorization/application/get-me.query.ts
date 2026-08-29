import { Injectable } from '@nestjs/common'

import type { AuthenticatedPrincipal } from '../../public-contracts/authenticated-principal'
import type { PermissionKey } from './permission'

/** Safe current-user projection returned by the browser auth API. */
export interface CurrentUserView {
  readonly userId: string
  readonly normalizedEmail: string
  readonly roleKeys: readonly string[]
  readonly permissions: readonly PermissionKey[]
}

/** Projects the already refreshed authenticated principal without new I/O. */
@Injectable()
export class GetMeQuery {
  public execute(principal: AuthenticatedPrincipal): CurrentUserView {
    return Object.freeze({
      userId: principal.userId,
      normalizedEmail: principal.normalizedEmail,
      roleKeys: Object.freeze([...principal.roleKeys]),
      permissions: Object.freeze([...principal.permissions]),
    })
  }
}
