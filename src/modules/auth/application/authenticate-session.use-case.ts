import {
  AuthDependencyUnavailableError,
  AuthError,
  AuthenticationRequiredError,
} from './auth-errors'
import type { AuthPersistencePort } from './auth-persistence.port'
import type { AuthenticatedPrincipal } from './auth.types'
import type { RoleRegistry } from './role-registry'
import type { SessionStorePort } from './session-store.port'
import {
  NOOP_TELEMETRY,
  type TelemetryPort,
} from '@/shared/application/telemetry.port'

/** Authenticates one opaque token against fresh durable account state. */
export class AuthenticateSessionUseCase {
  public constructor(
    private readonly sessions: SessionStorePort,
    private readonly persistence: AuthPersistencePort,
    private readonly roles: RoleRegistry,
    private readonly telemetry: TelemetryPort = NOOP_TELEMETRY,
  ) {}

  public async execute(
    rawToken: string,
    nowMs: number,
  ): Promise<AuthenticatedPrincipal> {
    return this.telemetry.runAuthOperation('authenticate', () =>
      this.performAuthentication(rawToken, nowMs),
    )
  }

  private async performAuthentication(
    rawToken: string,
    nowMs: number,
  ): Promise<AuthenticatedPrincipal> {
    try {
      const record = await this.sessions.readAndTouch(rawToken, nowMs)
      if (record === undefined) throw new AuthenticationRequiredError()
      const [projection, epoch] = await Promise.all([
        this.persistence.findAuthProjectionByUserId(record.userId),
        this.persistence.readGlobalSessionEpoch(),
      ])
      if (
        projection === undefined ||
        projection.sessionGeneration.toString(10) !==
          record.sessionGeneration ||
        epoch.toString(10) !== record.globalSessionEpoch
      ) {
        throw new AuthenticationRequiredError()
      }
      const permissions = this.roles.resolve(
        projection.status,
        projection.roleKeys,
      )
      const principal = Object.freeze({
        userId: projection.userId,
        sessionId: record.publicId,
        normalizedEmail: projection.normalizedEmail,
        roleKeys: Object.freeze([...projection.roleKeys]),
        permissions,
      })
      this.telemetry.recordAuthOutcome('authenticate', 'success')
      return principal
    } catch (error: unknown) {
      if (error instanceof AuthenticationRequiredError) {
        this.telemetry.recordAuthOutcome('authenticate', 'denied')
        throw error
      }
      if (error instanceof AuthDependencyUnavailableError) {
        this.telemetry.recordAuthOutcome('authenticate', 'dependency_error')
        throw error
      }
      if (error instanceof AuthError) {
        this.telemetry.recordAuthOutcome('authenticate', 'denied')
        throw new AuthenticationRequiredError()
      }
      this.telemetry.recordAuthOutcome('authenticate', 'dependency_error')
      throw new AuthDependencyUnavailableError()
    }
  }
}
