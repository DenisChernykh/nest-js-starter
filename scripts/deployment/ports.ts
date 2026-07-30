import type { DeploymentImageReference } from './manifest.js'

/**
 * Verifies that an immutable registry artifact matches its source revision.
 *
 * @remarks
 * Registry credentials remain caller-owned secrets. Implementations must not
 * log or persist them and must reject any unverifiable artifact.
 */
export interface ImageVerificationPort {
  /**
   * Verifies one digest-pinned image and its embedded revision.
   *
   * @throws Error when authentication, pull, inspection or revision matching
   * fails.
   */
  verifyImage(input: {
    readonly imageRef: string
    readonly revision: string
    readonly registryUrl: string
    readonly username: string
    readonly password: string
    readonly signal?: AbortSignal
  }): Promise<void>
}

/**
 * Runs database migration code from the exact approved image.
 *
 * @remarks
 * The database URL remains a caller-owned secret and must only be passed to
 * the migration child process.
 */
export interface MigratorPort {
  /**
   * Executes the migration entrypoint and reports its process exit code.
   *
   * @throws Error when the process cannot be created or observed.
   */
  migrate(input: {
    readonly imageRef: string
    readonly databaseUrl: string
    readonly signal?: AbortSignal
  }): Promise<{ readonly exitCode: number }>
}

/** Dokploy terminal and non-terminal states understood by the operator. */
export type DokployDeploymentStatus = 'running' | 'done' | 'error' | 'cancelled'

/**
 * Minimal deployment record returned by Dokploy.
 *
 * @remarks
 * Status intentionally remains an unrestricted string so new server states
 * reach the fail-closed orchestration policy.
 */
export interface DokployDeploymentRecord {
  readonly deploymentId: string
  readonly status: string
  readonly title?: string
}

/**
 * Controls one existing Dokploy application.
 *
 * @remarks
 * Implementations receive API and registry secrets in memory but must not log
 * or persist them outside Dokploy's requested configuration.
 */
export interface DokployPort {
  /**
   * Lists the deployment records currently visible for an application.
   *
   * @throws Error when Dokploy cannot return a complete valid response.
   */
  listDeployments(
    applicationId: string,
    signal?: AbortSignal,
  ): Promise<readonly DokployDeploymentRecord[]>

  /**
   * Replaces the complete runtime environment of an application.
   *
   * @throws Error when Dokploy does not confirm the request.
   */
  saveEnvironment(
    applicationId: string,
    environment: string,
    signal?: AbortSignal,
  ): Promise<void>

  /**
   * Replaces the Docker provider with an immutable private-registry image.
   *
   * @throws Error when Dokploy does not confirm the request.
   */
  saveDockerProvider(input: {
    readonly applicationId: string
    readonly imageRef: string
    readonly registryUrl: string
    readonly username: string
    readonly password: string
    readonly signal?: AbortSignal
  }): Promise<void>

  /**
   * Requests a deployment identified by the supplied operator title.
   *
   * @throws Error when Dokploy does not confirm the request.
   */
  deploy(input: {
    readonly applicationId: string
    readonly title: string
    readonly description: string
    readonly signal?: AbortSignal
  }): Promise<void>
}

/** Observable public checks required after a deployment reaches `done`. */
export interface ExternalSmokeResult {
  readonly live: boolean
  readonly startup: boolean
  readonly ready: boolean
  readonly unauthenticatedAuthProblem: boolean
}

/**
 * Checks the externally routed API boundary without credentials.
 */
export interface ExternalSmokePort {
  /**
   * Verifies health endpoints and the unauthenticated auth problem response.
   *
   * @throws Error when transport or response decoding prevents verification.
   */
  verify(
    publicApiUrl: string,
    signal?: AbortSignal,
  ): Promise<ExternalSmokeResult>
}

/**
 * Supplies deterministic wall-clock reads and bounded polling delays.
 */
export interface ClockPort {
  /** Returns Unix epoch time in milliseconds. */
  nowMs(): number

  /** Resolves after the requested non-negative delay. */
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>
}

/** Mutating operator workflow recorded in deployment evidence. */
export type DeploymentOperation = 'promote' | 'rollback'

/** Binary step and workflow outcome used by deployment evidence. */
export type DeploymentOutcome = 'succeeded' | 'failed'

/** One completed orchestration step recorded without secret-bearing values. */
export interface DeploymentEvidenceStep {
  readonly name: string
  readonly outcome: DeploymentOutcome
  readonly completedAt: string
}

/**
 * Complete secret-free evidence for one deployment operation.
 *
 * @remarks
 * Evidence stores immutable artifact identity and observable outcomes only. It
 * must never contain live environment values or authentication material.
 */
export interface DeploymentEvidence {
  readonly schemaVersion: 1
  readonly operation: DeploymentOperation
  readonly environment: string
  readonly repository: string
  readonly candidate: DeploymentImageReference
  readonly rollback: DeploymentImageReference
  readonly workflowRunUrl: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly steps: readonly DeploymentEvidenceStep[]
  readonly deploymentId?: string
  readonly terminalStatus?: string
  readonly migrationOutcome: 'not-run' | DeploymentOutcome
  readonly restorationAttempted: boolean
  readonly restorationSucceeded: boolean
  readonly smoke?: ExternalSmokeResult
  readonly outcome: DeploymentOutcome
}

/**
 * Publishes one finalized evidence document.
 */
export interface EvidencePort {
  /**
   * Writes evidence to a caller-selected path.
   *
   * @throws Error when secure exclusive publication cannot be guaranteed.
   */
  write(path: string, evidence: DeploymentEvidence): Promise<void>
}
