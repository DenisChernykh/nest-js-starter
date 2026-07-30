import type { DeploymentLiveEnvironment } from './live-environment.js'
import type { DeploymentReleaseManifest } from './manifest.js'
import type {
  ClockPort,
  DeploymentEvidence,
  DeploymentEvidenceStep,
  DeploymentOperation,
  DeploymentOutcome,
  DokployDeploymentRecord,
  DokployPort,
  EvidencePort,
  ExternalSmokePort,
  ExternalSmokeResult,
  ImageVerificationPort,
  MigratorPort,
} from './ports.js'

const pollIntervalMs = 5_000
const pollDeadlineMs = 600_000

/** External capabilities required by the deployment orchestration policy. */
export interface DeploymentOrchestratorDependencies {
  readonly image: ImageVerificationPort
  readonly migrator: MigratorPort
  readonly dokploy: DokployPort
  readonly smoke: ExternalSmokePort
  readonly clock: ClockPort
  readonly evidence: EvidencePort
}

/** Validated inputs for one explicit mutating deployment operation. */
export interface ApplyDeploymentInput {
  readonly manifest: DeploymentReleaseManifest
  readonly live: DeploymentLiveEnvironment
  readonly evidencePath: string
  readonly signal?: AbortSignal
}

/**
 * Redacted failure returned after bounded orchestration and restoration.
 */
export class DeploymentExecutionError extends Error {
  readonly step: string
  readonly category: string

  /**
   * Creates an execution error containing policy metadata only.
   *
   * @param step - Fixed orchestration step that failed.
   * @param category - Fixed failure category without upstream response data.
   */
  constructor(step: string, category: string) {
    super(`Deployment failed at ${step} (${category})`)
    this.name = 'DeploymentExecutionError'
    this.step = step
    this.category = category
  }

  /** Returns the redacted stable error contract. */
  toJSON(): Readonly<{
    name: string
    message: string
    step: string
    category: string
  }> {
    return Object.freeze({
      name: this.name,
      message: this.message,
      step: this.step,
      category: this.category,
    })
  }
}

interface EvidenceRecorder {
  readonly startedAt: string
  readonly steps: DeploymentEvidenceStep[]
  migrationOutcome: 'not-run' | DeploymentOutcome
  deploymentId?: string
  terminalStatus?: string
  smoke?: ExternalSmokeResult
  restorationAttempted: boolean
  restorationSucceeded: boolean
  record(name: string, outcome: DeploymentOutcome): void
  build(outcome: DeploymentOutcome): DeploymentEvidence
}

function createEvidenceRecorder(
  operation: DeploymentOperation,
  input: ApplyDeploymentInput,
  clock: ClockPort,
): EvidenceRecorder {
  const { manifest } = input
  const steps: DeploymentEvidenceStep[] = []
  const recorder: EvidenceRecorder = {
    startedAt: new Date(clock.nowMs()).toISOString(),
    steps,
    migrationOutcome: 'not-run',
    restorationAttempted: false,
    restorationSucceeded: false,
    record(name, outcome) {
      steps.push(
        Object.freeze({
          name,
          outcome,
          completedAt: new Date(clock.nowMs()).toISOString(),
        }),
      )
    },
    build(outcome) {
      const candidate = Object.freeze({
        imageRef: manifest.candidate.imageRef,
        revision: manifest.candidate.revision,
      })
      const rollback = Object.freeze({
        imageRef: manifest.rollback.imageRef,
        revision: manifest.rollback.revision,
      })
      const frozenSteps = Object.freeze([...steps])
      const smoke =
        recorder.smoke === undefined
          ? undefined
          : Object.freeze({ ...recorder.smoke })
      return Object.freeze({
        schemaVersion: 1 as const,
        operation,
        environment: manifest.environment,
        repository: manifest.repository,
        candidate,
        rollback,
        workflowRunUrl: manifest.candidate.workflowRunUrl,
        startedAt: recorder.startedAt,
        finishedAt: new Date(clock.nowMs()).toISOString(),
        steps: frozenSteps,
        ...(recorder.deploymentId === undefined
          ? {}
          : { deploymentId: recorder.deploymentId }),
        ...(recorder.terminalStatus === undefined
          ? {}
          : { terminalStatus: recorder.terminalStatus }),
        migrationOutcome: recorder.migrationOutcome,
        restorationAttempted: recorder.restorationAttempted,
        restorationSucceeded: recorder.restorationSucceeded,
        ...(smoke === undefined ? {} : { smoke }),
        outcome,
      })
    },
  }
  return recorder
}

function executionError(
  error: unknown,
  step: string,
): DeploymentExecutionError {
  return error instanceof DeploymentExecutionError
    ? error
    : new DeploymentExecutionError(step, 'external-operation')
}

async function performStep<T>(
  recorder: EvidenceRecorder,
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    const result = await operation()
    recorder.record(name, 'succeeded')
    return result
  } catch (error) {
    recorder.record(name, 'failed')
    throw executionError(error, name)
  }
}

function identifyNewDeployment(
  before: readonly DokployDeploymentRecord[],
  after: readonly DokployDeploymentRecord[],
  title: string,
): DokployDeploymentRecord {
  const previousIds = new Set(
    before.map((deployment) => deployment.deploymentId),
  )
  const matches = after.filter(
    (deployment) =>
      !previousIds.has(deployment.deploymentId) && deployment.title === title,
  )
  if (matches.length !== 1) {
    throw new DeploymentExecutionError(
      'identify-deployment',
      'ambiguous-deployment',
    )
  }
  return matches[0]!
}

async function pollDeployment(
  dokploy: DokployPort,
  clock: ClockPort,
  applicationId: string,
  initial: DokployDeploymentRecord,
  observe: (deployment: DokployDeploymentRecord) => void,
  signal?: AbortSignal,
): Promise<DokployDeploymentRecord> {
  const deadline = clock.nowMs() + pollDeadlineMs
  let current = initial

  while (true) {
    if (current.status === 'done') return current
    if (current.status !== 'running') {
      throw new DeploymentExecutionError('poll-deployment', 'unexpected-status')
    }
    if (clock.nowMs() >= deadline) {
      throw new DeploymentExecutionError('poll-deployment', 'deadline')
    }

    const remainingMs = deadline - clock.nowMs()
    await clock.sleep(Math.min(pollIntervalMs, remainingMs), signal)
    if (clock.nowMs() >= deadline) {
      throw new DeploymentExecutionError('poll-deployment', 'deadline')
    }

    const records = await dokploy.listDeployments(applicationId, signal)
    if (clock.nowMs() >= deadline) {
      throw new DeploymentExecutionError('poll-deployment', 'deadline')
    }
    const matches = records.filter(
      (deployment) => deployment.deploymentId === initial.deploymentId,
    )
    if (matches.length !== 1) {
      throw new DeploymentExecutionError(
        'poll-deployment',
        'invalid-deployment-record',
      )
    }
    current = matches[0]!
    observe(current)
  }
}

function requireSuccessfulSmoke(result: ExternalSmokeResult): void {
  if (
    !result.live ||
    !result.startup ||
    !result.ready ||
    !result.unauthenticatedAuthProblem
  ) {
    throw new DeploymentExecutionError('external-smoke', 'check-failed')
  }
}

async function restorePreviousEnvironment(
  dependencies: DeploymentOrchestratorDependencies,
  input: ApplyDeploymentInput,
  recorder: EvidenceRecorder,
): Promise<void> {
  recorder.restorationAttempted = true
  try {
    await dependencies.dokploy.saveEnvironment(
      input.live.dokployApplicationId,
      input.live.dokployPreviousApplicationEnvironment,
    )
    recorder.restorationSucceeded = true
    recorder.record('restore-previous-environment', 'succeeded')
  } catch {
    recorder.restorationSucceeded = false
    recorder.record('restore-previous-environment', 'failed')
  }
}

/**
 * Builds the local-only promotion plan without constructing external adapters.
 *
 * @param manifest - Already validated release manifest.
 * @returns A fixed, immutable list of intended policy steps.
 */
export function createDryRunPlan(
  manifest: DeploymentReleaseManifest,
): readonly string[] {
  void manifest
  return Object.freeze([
    'validate release manifest',
    'verify candidate GHCR digest and OCI revision',
    'run one-shot Prisma migrator',
    'save complete Dokploy runtime environment',
    'save exact candidate Docker provider',
    'deploy and identify one Dokploy record',
    'poll identified deployment to done',
    'run external health/auth smoke',
    'write redacted evidence',
  ])
}

/**
 * Applies explicit promotion and rollback policies to one Dokploy application.
 *
 * @remarks
 * Promotion never invokes rollback automatically. Once environment mutation
 * starts, failures trigger exactly one bounded restoration attempt.
 */
export class DeploymentOrchestrator {
  readonly #dependencies: DeploymentOrchestratorDependencies

  /**
   * Creates an orchestrator over side-effecting adapter ports.
   *
   * @param dependencies - Explicit external capabilities and deterministic clock.
   */
  constructor(dependencies: DeploymentOrchestratorDependencies) {
    this.#dependencies = dependencies
  }

  /**
   * Verifies, migrates and promotes the exact candidate digest.
   *
   * @param input - Validated manifest, live secrets and evidence destination.
   * @returns Redacted evidence already published through the evidence port.
   * @throws DeploymentExecutionError after bounded failure handling.
   */
  async promote(input: ApplyDeploymentInput): Promise<DeploymentEvidence> {
    const recorder = createEvidenceRecorder(
      'promote',
      input,
      this.#dependencies.clock,
    )
    let environmentMutationStarted = false
    let activeStep = 'verify-candidate-image'

    try {
      await performStep(recorder, activeStep, () =>
        this.#dependencies.image.verifyImage({
          imageRef: input.manifest.candidate.imageRef,
          revision: input.manifest.candidate.revision,
          registryUrl: input.live.ghcrRegistryUrl,
          username: input.live.ghcrUsername,
          password: input.live.ghcrPassword,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        }),
      )

      activeStep = 'migrate-candidate'
      await performStep(recorder, activeStep, async () => {
        recorder.migrationOutcome = 'failed'
        const migration = await this.#dependencies.migrator.migrate({
          imageRef: input.manifest.candidate.imageRef,
          databaseUrl: input.live.migrationDatabaseUrl,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        })
        if (migration.exitCode !== 0) {
          throw new DeploymentExecutionError(activeStep, 'non-zero-exit')
        }
        recorder.migrationOutcome = 'succeeded'
      })

      activeStep = 'list-deployments-before'
      const before = await performStep(recorder, activeStep, () =>
        this.#dependencies.dokploy.listDeployments(
          input.live.dokployApplicationId,
          input.signal,
        ),
      )

      activeStep = 'save-candidate-environment'
      environmentMutationStarted = true
      await performStep(recorder, activeStep, () =>
        this.#dependencies.dokploy.saveEnvironment(
          input.live.dokployApplicationId,
          input.live.dokployApplicationEnvironment,
          input.signal,
        ),
      )

      activeStep = 'save-candidate-provider'
      await performStep(recorder, activeStep, () =>
        this.#dependencies.dokploy.saveDockerProvider({
          applicationId: input.live.dokployApplicationId,
          imageRef: input.manifest.candidate.imageRef,
          registryUrl: input.live.ghcrRegistryUrl,
          username: input.live.ghcrUsername,
          password: input.live.ghcrPassword,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        }),
      )

      const title = `${input.manifest.environment}-${input.manifest.candidate.revision}`
      activeStep = 'deploy-candidate'
      await performStep(recorder, activeStep, () =>
        this.#dependencies.dokploy.deploy({
          applicationId: input.live.dokployApplicationId,
          title,
          description: `Deploy ${input.manifest.candidate.revision}`,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        }),
      )

      activeStep = 'list-deployments-after'
      const after = await performStep(recorder, activeStep, () =>
        this.#dependencies.dokploy.listDeployments(
          input.live.dokployApplicationId,
          input.signal,
        ),
      )

      activeStep = 'identify-deployment'
      const identified = await performStep(recorder, activeStep, () =>
        Promise.resolve(identifyNewDeployment(before, after, title)),
      )
      recorder.deploymentId = identified.deploymentId
      recorder.terminalStatus = identified.status

      activeStep = 'poll-deployment'
      const terminal = await performStep(recorder, activeStep, () =>
        pollDeployment(
          this.#dependencies.dokploy,
          this.#dependencies.clock,
          input.live.dokployApplicationId,
          identified,
          (deployment) => {
            recorder.terminalStatus = deployment.status
          },
          input.signal,
        ),
      )
      recorder.terminalStatus = terminal.status

      activeStep = 'external-smoke'
      const smoke = await performStep(recorder, activeStep, async () => {
        const result = await this.#dependencies.smoke.verify(
          input.manifest.publicApiUrl,
          input.signal,
        )
        recorder.smoke = result
        requireSuccessfulSmoke(result)
        return result
      })
      recorder.smoke = smoke

      const evidence = recorder.build('succeeded')
      activeStep = 'write-evidence'
      await this.#dependencies.evidence.write(input.evidencePath, evidence)
      return evidence
    } catch (error) {
      const failure =
        activeStep === 'write-evidence'
          ? new DeploymentExecutionError(activeStep, 'publication')
          : executionError(error, activeStep)
      if (activeStep === 'write-evidence') throw failure
      if (environmentMutationStarted) {
        await restorePreviousEnvironment(this.#dependencies, input, recorder)
      }
      const evidence = recorder.build('failed')
      try {
        await this.#dependencies.evidence.write(input.evidencePath, evidence)
      } catch {
        throw failure
      }
      throw failure
    }
  }

  /**
   * Restores the approved rollback digest without running a migration.
   *
   * @param input - Validated manifest, live secrets and evidence destination.
   * @returns Redacted evidence already published through the evidence port.
   * @throws DeploymentExecutionError after bounded failure handling.
   */
  async rollback(input: ApplyDeploymentInput): Promise<DeploymentEvidence> {
    if (
      input.manifest.rollback.schemaCompatibilityEvidence.trim().length === 0
    ) {
      throw new DeploymentExecutionError(
        'validate-schema-compatibility',
        'input',
      )
    }

    const recorder = createEvidenceRecorder(
      'rollback',
      input,
      this.#dependencies.clock,
    )
    let environmentMutationStarted = false
    let activeStep = 'verify-rollback-image'

    try {
      await performStep(recorder, activeStep, () =>
        this.#dependencies.image.verifyImage({
          imageRef: input.manifest.rollback.imageRef,
          revision: input.manifest.rollback.revision,
          registryUrl: input.live.ghcrRegistryUrl,
          username: input.live.ghcrUsername,
          password: input.live.ghcrPassword,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        }),
      )

      activeStep = 'list-deployments-before'
      const before = await performStep(recorder, activeStep, () =>
        this.#dependencies.dokploy.listDeployments(
          input.live.dokployApplicationId,
          input.signal,
        ),
      )

      activeStep = 'save-previous-environment'
      environmentMutationStarted = true
      await performStep(recorder, activeStep, () =>
        this.#dependencies.dokploy.saveEnvironment(
          input.live.dokployApplicationId,
          input.live.dokployPreviousApplicationEnvironment,
          input.signal,
        ),
      )

      activeStep = 'save-rollback-provider'
      await performStep(recorder, activeStep, () =>
        this.#dependencies.dokploy.saveDockerProvider({
          applicationId: input.live.dokployApplicationId,
          imageRef: input.manifest.rollback.imageRef,
          registryUrl: input.live.ghcrRegistryUrl,
          username: input.live.ghcrUsername,
          password: input.live.ghcrPassword,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        }),
      )

      const title = `${input.manifest.environment}-${input.manifest.rollback.revision}`
      activeStep = 'deploy-rollback'
      await performStep(recorder, activeStep, () =>
        this.#dependencies.dokploy.deploy({
          applicationId: input.live.dokployApplicationId,
          title,
          description: `Rollback ${input.manifest.rollback.revision}`,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        }),
      )

      activeStep = 'list-deployments-after'
      const after = await performStep(recorder, activeStep, () =>
        this.#dependencies.dokploy.listDeployments(
          input.live.dokployApplicationId,
          input.signal,
        ),
      )

      activeStep = 'identify-deployment'
      const identified = await performStep(recorder, activeStep, () =>
        Promise.resolve(identifyNewDeployment(before, after, title)),
      )
      recorder.deploymentId = identified.deploymentId
      recorder.terminalStatus = identified.status

      activeStep = 'poll-deployment'
      const terminal = await performStep(recorder, activeStep, () =>
        pollDeployment(
          this.#dependencies.dokploy,
          this.#dependencies.clock,
          input.live.dokployApplicationId,
          identified,
          (deployment) => {
            recorder.terminalStatus = deployment.status
          },
          input.signal,
        ),
      )
      recorder.terminalStatus = terminal.status

      activeStep = 'external-smoke'
      const smoke = await performStep(recorder, activeStep, async () => {
        const result = await this.#dependencies.smoke.verify(
          input.manifest.publicApiUrl,
          input.signal,
        )
        recorder.smoke = result
        requireSuccessfulSmoke(result)
        return result
      })
      recorder.smoke = smoke

      const evidence = recorder.build('succeeded')
      activeStep = 'write-evidence'
      await this.#dependencies.evidence.write(input.evidencePath, evidence)
      return evidence
    } catch (error) {
      const failure =
        activeStep === 'write-evidence'
          ? new DeploymentExecutionError(activeStep, 'publication')
          : executionError(error, activeStep)
      if (activeStep === 'write-evidence') throw failure
      if (environmentMutationStarted) {
        await restorePreviousEnvironment(this.#dependencies, input, recorder)
      }
      const evidence = recorder.build('failed')
      try {
        await this.#dependencies.evidence.write(input.evidencePath, evidence)
      } catch {
        throw failure
      }
      throw failure
    }
  }
}
