import {
  createDryRunPlan,
  DeploymentExecutionError,
  DeploymentOrchestrator,
  type DeploymentOrchestratorDependencies,
} from '@scripts/deployment/deployment-orchestrator'
import type { DeploymentLiveEnvironment } from '@scripts/deployment/live-environment'
import type { DeploymentReleaseManifest } from '@scripts/deployment/manifest'
import type {
  ClockPort,
  DeploymentEvidence,
  DokployDeploymentRecord,
} from '@scripts/deployment/ports'

const candidate = {
  imageRef:
    'ghcr.io/denischernykh/nest-js-starter@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  revision: '1'.repeat(40),
  workflowRunUrl:
    'https://github.com/DenisChernykh/nest-js-starter/actions/runs/123456789',
} as const
const rollback = {
  imageRef:
    'ghcr.io/denischernykh/nest-js-starter@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  revision: '2'.repeat(40),
  schemaCompatibilityEvidence: 'review/rollback-compatible',
} as const
const manifest: DeploymentReleaseManifest = {
  schemaVersion: 1,
  environment: 'stage',
  repository: 'DenisChernykh/nest-js-starter',
  candidate,
  rollback,
  publicApiUrl: 'https://stage-api.example.com',
}
const live: DeploymentLiveEnvironment = {
  dokployBaseUrl: 'https://dokploy.example.com',
  dokployApiKey: 'dokploy-api-secret',
  dokployApplicationId: 'application-id',
  dokployApplicationEnvironment:
    'DATABASE_URL=postgresql://runtime:secret@database.example.com/app',
  dokployPreviousApplicationEnvironment:
    'DATABASE_URL=postgresql://previous:secret@database.example.com/app',
  ghcrRegistryUrl: 'https://ghcr.io',
  ghcrUsername: 'registry-user',
  ghcrPassword: 'registry-secret',
  migrationDatabaseUrl: 'postgresql://migrator:secret@database.example.com/app',
  runtimeDatabaseUrl: 'postgresql://runtime:secret@database.example.com/app',
}

async function settle(): Promise<void> {
  await Promise.resolve()
}

function createClock(events: string[]): ClockPort {
  let now = Date.parse('2026-07-30T10:00:00.000Z')
  return {
    nowMs: () => now,
    sleep: async (milliseconds) => {
      await settle()
      events.push(`sleep:${milliseconds}`)
      now += milliseconds
    },
  }
}

function createPromotionDependencies(
  events: string[],
  evidence: DeploymentEvidence[],
): DeploymentOrchestratorDependencies {
  const oldDeployment: DokployDeploymentRecord = {
    deploymentId: 'old',
    status: 'done',
    title: 'old',
  }
  const newDeployment: DokployDeploymentRecord = {
    deploymentId: 'new',
    status: 'running',
    title: `stage-${candidate.revision}`,
  }
  let listCall = 0

  return {
    image: {
      verifyImage: async () => {
        await settle()
        events.push('verify:candidate')
      },
    },
    migrator: {
      migrate: async () => {
        await settle()
        events.push('migrate:candidate')
        return { exitCode: 0 }
      },
    },
    dokploy: {
      listDeployments: async () => {
        await settle()
        listCall += 1
        if (listCall === 1) {
          events.push('list:before')
          return [oldDeployment]
        }
        if (listCall === 2) {
          events.push('list:after')
          return [oldDeployment, newDeployment]
        }
        events.push('list:poll')
        return [oldDeployment, { ...newDeployment, status: 'done' }]
      },
      saveEnvironment: async () => {
        await settle()
        events.push('save-environment:candidate')
      },
      saveDockerProvider: async () => {
        await settle()
        events.push('save-provider:candidate')
      },
      deploy: async () => {
        await settle()
        events.push('deploy:candidate')
      },
    },
    smoke: {
      verify: async () => {
        await settle()
        events.push('smoke')
        return {
          live: true,
          startup: true,
          ready: true,
          unauthenticatedAuthProblem: true,
        }
      },
    },
    clock: createClock(events),
    evidence: {
      write: async (_path, value) => {
        await settle()
        events.push('evidence')
        evidence.push(value)
      },
    },
  }
}

type FailurePoint =
  | 'verify'
  | 'migrate-exit'
  | 'list-before'
  | 'save-environment'
  | 'save-provider'
  | 'deploy'
  | 'list-after'
  | 'identify-zero'
  | 'identify-two'
  | 'poll-error'
  | 'poll-cancelled'
  | 'poll-unknown'
  | 'poll-missing'
  | 'poll-duplicated'
  | 'poll-deadline'
  | 'smoke'
  | 'restoration'

interface FailureScenario {
  readonly dependencies: DeploymentOrchestratorDependencies
  readonly events: string[]
  readonly evidence: DeploymentEvidence[]
  readonly verifiedImages: string[]
  readonly migratedImages: string[]
}

function createFailureScenario(failurePoint: FailurePoint): FailureScenario {
  const events: string[] = []
  const evidence: DeploymentEvidence[] = []
  const verifiedImages: string[] = []
  const migratedImages: string[] = []
  const oldDeployment: DokployDeploymentRecord = {
    deploymentId: 'old',
    status: 'done',
    title: 'old',
  }
  const newDeployment: DokployDeploymentRecord = {
    deploymentId: 'new',
    status: 'running',
    title: `stage-${candidate.revision}`,
  }
  let listCall = 0
  let now = Date.parse('2026-07-30T10:00:00.000Z')

  const dependencies: DeploymentOrchestratorDependencies = {
    image: {
      verifyImage: async ({ imageRef }) => {
        await settle()
        events.push('verify:candidate')
        verifiedImages.push(imageRef)
        if (failurePoint === 'verify') throw new Error('private upstream body')
      },
    },
    migrator: {
      migrate: async ({ imageRef }) => {
        await settle()
        events.push('migrate:candidate')
        migratedImages.push(imageRef)
        return { exitCode: failurePoint === 'migrate-exit' ? 1 : 0 }
      },
    },
    dokploy: {
      listDeployments: async () => {
        await settle()
        listCall += 1
        if (listCall === 1) {
          events.push('list:before')
          if (failurePoint === 'list-before') throw new Error('private body')
          return [oldDeployment]
        }
        if (listCall === 2) {
          events.push('list:after')
          if (failurePoint === 'list-after') throw new Error('private body')
          if (failurePoint === 'identify-zero') return [oldDeployment]
          if (failurePoint === 'identify-two') {
            return [
              oldDeployment,
              newDeployment,
              { ...newDeployment, deploymentId: 'new-2' },
            ]
          }
          return [oldDeployment, newDeployment]
        }

        events.push('list:poll')
        if (failurePoint === 'poll-missing') return [oldDeployment]
        if (failurePoint === 'poll-duplicated') {
          return [newDeployment, { ...newDeployment }]
        }
        const statusByFailure: Partial<Record<FailurePoint, string>> = {
          'poll-error': 'error',
          'poll-cancelled': 'cancelled',
          'poll-unknown': 'queued-by-new-server',
          'poll-deadline': 'running',
        }
        return [
          oldDeployment,
          {
            ...newDeployment,
            status: statusByFailure[failurePoint] ?? 'done',
          },
        ]
      },
      saveEnvironment: async (_applicationId, environment) => {
        await settle()
        if (environment === live.dokployPreviousApplicationEnvironment) {
          events.push('restore-environment')
          if (failurePoint === 'restoration') {
            throw new Error('private restoration body')
          }
          return
        }
        events.push('save-environment:candidate')
        if (failurePoint === 'save-environment') {
          throw new Error('private upstream body')
        }
      },
      saveDockerProvider: async () => {
        await settle()
        events.push('save-provider:candidate')
        if (failurePoint === 'save-provider') {
          throw new Error('private upstream body')
        }
      },
      deploy: async () => {
        await settle()
        events.push('deploy:candidate')
        if (failurePoint === 'deploy') throw new Error('private upstream body')
      },
    },
    smoke: {
      verify: async () => {
        await settle()
        events.push('smoke')
        return {
          live: true,
          startup: true,
          ready: failurePoint !== 'smoke',
          unauthenticatedAuthProblem: true,
        }
      },
    },
    clock: {
      nowMs: () => now,
      sleep: async (milliseconds) => {
        await settle()
        events.push(`sleep:${milliseconds}`)
        now += failurePoint === 'poll-deadline' ? 600_000 : milliseconds
      },
    },
    evidence: {
      write: async (_path, value) => {
        await settle()
        events.push('evidence')
        evidence.push(value)
      },
    },
  }

  return {
    dependencies,
    events,
    evidence,
    verifiedImages,
    migratedImages,
  }
}

describe('createDryRunPlan', () => {
  it('returns an offline promotion plan without invoking an adapter', () => {
    const events: string[] = []

    expect(createDryRunPlan(manifest)).toEqual([
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
    expect(events).toEqual([])
  })
})

describe('DeploymentOrchestrator promotion', () => {
  it('promotes one exact candidate in deterministic order', async () => {
    const events: string[] = []
    const writtenEvidence: DeploymentEvidence[] = []
    const orchestrator = new DeploymentOrchestrator(
      createPromotionDependencies(events, writtenEvidence),
    )

    const result = await orchestrator.promote({
      manifest,
      live,
      evidencePath: 'promotion-evidence.json',
    })

    expect(events).toEqual([
      'verify:candidate',
      'migrate:candidate',
      'list:before',
      'save-environment:candidate',
      'save-provider:candidate',
      'deploy:candidate',
      'list:after',
      'sleep:5000',
      'list:poll',
      'smoke',
      'evidence',
    ])
    expect(writtenEvidence).toEqual([result])
    expect(result).toMatchObject({
      schemaVersion: 1,
      operation: 'promote',
      environment: 'stage',
      repository: 'DenisChernykh/nest-js-starter',
      candidate: {
        imageRef: candidate.imageRef,
        revision: candidate.revision,
      },
      rollback: {
        imageRef: rollback.imageRef,
        revision: rollback.revision,
      },
      workflowRunUrl: candidate.workflowRunUrl,
      deploymentId: 'new',
      terminalStatus: 'done',
      migrationOutcome: 'succeeded',
      restorationAttempted: false,
      restorationSucceeded: false,
      outcome: 'succeeded',
    })
    expect(JSON.stringify(result)).not.toContain(live.dokployApiKey)
    expect(JSON.stringify(result)).not.toContain(live.ghcrPassword)
    expect(JSON.stringify(result)).not.toContain(live.runtimeDatabaseUrl)
  })

  it.each([
    {
      failurePoint: 'verify' as const,
      expectedStep: 'verify-candidate-image',
      mutationStarted: false,
    },
    {
      failurePoint: 'migrate-exit' as const,
      expectedStep: 'migrate-candidate',
      mutationStarted: false,
    },
    {
      failurePoint: 'list-before' as const,
      expectedStep: 'list-deployments-before',
      mutationStarted: false,
    },
    {
      failurePoint: 'save-environment' as const,
      expectedStep: 'save-candidate-environment',
      mutationStarted: true,
    },
    {
      failurePoint: 'save-provider' as const,
      expectedStep: 'save-candidate-provider',
      mutationStarted: true,
    },
    {
      failurePoint: 'deploy' as const,
      expectedStep: 'deploy-candidate',
      mutationStarted: true,
    },
    {
      failurePoint: 'list-after' as const,
      expectedStep: 'list-deployments-after',
      mutationStarted: true,
    },
    {
      failurePoint: 'identify-zero' as const,
      expectedStep: 'identify-deployment',
      mutationStarted: true,
    },
    {
      failurePoint: 'identify-two' as const,
      expectedStep: 'identify-deployment',
      mutationStarted: true,
    },
    {
      failurePoint: 'poll-error' as const,
      expectedStep: 'poll-deployment',
      mutationStarted: true,
    },
    {
      failurePoint: 'poll-cancelled' as const,
      expectedStep: 'poll-deployment',
      mutationStarted: true,
    },
    {
      failurePoint: 'poll-unknown' as const,
      expectedStep: 'poll-deployment',
      mutationStarted: true,
    },
    {
      failurePoint: 'poll-missing' as const,
      expectedStep: 'poll-deployment',
      mutationStarted: true,
    },
    {
      failurePoint: 'poll-duplicated' as const,
      expectedStep: 'poll-deployment',
      mutationStarted: true,
    },
    {
      failurePoint: 'poll-deadline' as const,
      expectedStep: 'poll-deployment',
      mutationStarted: true,
    },
    {
      failurePoint: 'smoke' as const,
      expectedStep: 'external-smoke',
      mutationStarted: true,
    },
  ])(
    'fails closed at $failurePoint and never auto-rolls back',
    async ({ failurePoint, expectedStep, mutationStarted }) => {
      const scenario = createFailureScenario(failurePoint)
      const orchestrator = new DeploymentOrchestrator(scenario.dependencies)

      const operation = orchestrator.promote({
        manifest,
        live,
        evidencePath: 'failure-evidence.json',
      })

      await expect(operation).rejects.toMatchObject({
        name: 'DeploymentExecutionError',
        step: expectedStep,
      })
      expect(scenario.events.at(-1)).toBe('evidence')
      expect(scenario.events.includes('restore-environment')).toBe(
        mutationStarted,
      )
      expect(scenario.evidence).toHaveLength(1)
      expect(scenario.evidence[0]).toMatchObject({
        operation: 'promote',
        outcome: 'failed',
        restorationAttempted: mutationStarted,
        restorationSucceeded: mutationStarted,
      })
      expect(scenario.verifiedImages).toEqual([candidate.imageRef])
      expect(scenario.verifiedImages).not.toContain(rollback.imageRef)
      expect(scenario.migratedImages).not.toContain(rollback.imageRef)
      expect(scenario.migratedImages.length).toBeLessThanOrEqual(1)
      expect(JSON.stringify(scenario.evidence[0])).not.toContain(
        'private upstream body',
      )
    },
  )

  it('records a critical restoration failure without replacing the original failure', async () => {
    const scenario = createFailureScenario('restoration')
    scenario.dependencies.dokploy.deploy = async () => {
      await settle()
      scenario.events.push('deploy:candidate')
      throw new Error('original private deployment body')
    }
    const orchestrator = new DeploymentOrchestrator(scenario.dependencies)

    const operation = orchestrator.promote({
      manifest,
      live,
      evidencePath: 'failure-evidence.json',
    })

    await expect(operation).rejects.toEqual(
      expect.objectContaining({
        name: 'DeploymentExecutionError',
        step: 'deploy-candidate',
        category: 'external-operation',
      }),
    )
    expect(scenario.events.slice(-2)).toEqual([
      'restore-environment',
      'evidence',
    ])
    expect(scenario.evidence[0]).toMatchObject({
      restorationAttempted: true,
      restorationSucceeded: false,
      outcome: 'failed',
    })
    expect(scenario.evidence[0]!.steps.at(-1)).toMatchObject({
      name: 'restore-previous-environment',
      outcome: 'failed',
    })
    expect(JSON.stringify(scenario.evidence[0])).not.toContain(
      'original private deployment body',
    )
    expect(JSON.stringify(scenario.evidence[0])).not.toContain(
      'private restoration body',
    )
  })

  it('does not reach Dokploy or smoke after a migration exit failure', async () => {
    const scenario = createFailureScenario('migrate-exit')
    const orchestrator = new DeploymentOrchestrator(scenario.dependencies)

    await expect(
      orchestrator.promote({
        manifest,
        live,
        evidencePath: 'failure-evidence.json',
      }),
    ).rejects.toBeInstanceOf(DeploymentExecutionError)

    expect(scenario.events).toEqual([
      'verify:candidate',
      'migrate:candidate',
      'evidence',
    ])
  })

  it('does not migrate or reach Dokploy after image verification fails', async () => {
    const scenario = createFailureScenario('verify')
    const orchestrator = new DeploymentOrchestrator(scenario.dependencies)

    await expect(
      orchestrator.promote({
        manifest,
        live,
        evidencePath: 'failure-evidence.json',
      }),
    ).rejects.toBeInstanceOf(DeploymentExecutionError)

    expect(scenario.events).toEqual(['verify:candidate', 'evidence'])
  })

  it('does not restore or attempt a second write when success evidence publication fails', async () => {
    const events: string[] = []
    const dependencies = createPromotionDependencies(events, [])
    dependencies.evidence.write = async () => {
      await settle()
      events.push('evidence')
      throw new Error('private filesystem body')
    }
    const orchestrator = new DeploymentOrchestrator(dependencies)

    await expect(
      orchestrator.promote({
        manifest,
        live,
        evidencePath: 'promotion-evidence.json',
      }),
    ).rejects.toMatchObject({
      name: 'DeploymentExecutionError',
      step: 'write-evidence',
      category: 'publication',
    })
    expect(events.filter((event) => event === 'evidence')).toHaveLength(1)
    expect(events).not.toContain('restore-environment')
  })
})

describe('DeploymentOrchestrator rollback', () => {
  it('restores the exact approved rollback image without migrating', async () => {
    const events: string[] = []
    const writtenEvidence: DeploymentEvidence[] = []
    const oldDeployment: DokployDeploymentRecord = {
      deploymentId: 'old',
      status: 'done',
      title: 'old',
    }
    const newDeployment: DokployDeploymentRecord = {
      deploymentId: 'rollback-new',
      status: 'running',
      title: `stage-${rollback.revision}`,
    }
    let listCall = 0
    const dependencies: DeploymentOrchestratorDependencies = {
      image: {
        verifyImage: async ({ imageRef, revision }) => {
          await settle()
          expect({ imageRef, revision }).toEqual({
            imageRef: rollback.imageRef,
            revision: rollback.revision,
          })
          events.push('verify:rollback')
        },
      },
      migrator: {
        migrate: async () => {
          await settle()
          events.push('migrate:unexpected')
          return { exitCode: 0 }
        },
      },
      dokploy: {
        listDeployments: async () => {
          await settle()
          listCall += 1
          if (listCall === 1) {
            events.push('list:before')
            return [oldDeployment]
          }
          if (listCall === 2) {
            events.push('list:after')
            return [oldDeployment, newDeployment]
          }
          events.push('list:poll')
          return [oldDeployment, { ...newDeployment, status: 'done' }]
        },
        saveEnvironment: async (_applicationId, environment) => {
          await settle()
          expect(environment).toBe(live.dokployPreviousApplicationEnvironment)
          events.push('save-environment:previous')
        },
        saveDockerProvider: async ({ imageRef }) => {
          await settle()
          expect(imageRef).toBe(rollback.imageRef)
          events.push('save-provider:rollback')
        },
        deploy: async ({ title }) => {
          await settle()
          expect(title).toBe(`stage-${rollback.revision}`)
          events.push('deploy:rollback')
        },
      },
      smoke: {
        verify: async () => {
          await settle()
          events.push('smoke')
          return {
            live: true,
            startup: true,
            ready: true,
            unauthenticatedAuthProblem: true,
          }
        },
      },
      clock: createClock(events),
      evidence: {
        write: async (_path, value) => {
          await settle()
          events.push('evidence')
          writtenEvidence.push(value)
        },
      },
    }
    const orchestrator = new DeploymentOrchestrator(dependencies)

    const result = await orchestrator.rollback({
      manifest,
      live,
      evidencePath: 'rollback-evidence.json',
    })

    expect(events).toEqual([
      'verify:rollback',
      'list:before',
      'save-environment:previous',
      'save-provider:rollback',
      'deploy:rollback',
      'list:after',
      'sleep:5000',
      'list:poll',
      'smoke',
      'evidence',
    ])
    expect(events).not.toContain('migrate:unexpected')
    expect(writtenEvidence).toEqual([result])
    expect(result).toMatchObject({
      operation: 'rollback',
      deploymentId: 'rollback-new',
      terminalStatus: 'done',
      migrationOutcome: 'not-run',
      restorationAttempted: false,
      restorationSucceeded: false,
      outcome: 'succeeded',
    })
  })

  it('rejects missing schema compatibility evidence before any adapter call', async () => {
    const events: string[] = []
    const dependencies = createPromotionDependencies(events, [])
    const forgedManifest: DeploymentReleaseManifest = {
      ...manifest,
      rollback: {
        ...manifest.rollback,
        schemaCompatibilityEvidence: ' ',
      },
    }
    const orchestrator = new DeploymentOrchestrator(dependencies)

    await expect(
      orchestrator.rollback({
        manifest: forgedManifest,
        live,
        evidencePath: 'rollback-evidence.json',
      }),
    ).rejects.toMatchObject({
      name: 'DeploymentExecutionError',
      step: 'validate-schema-compatibility',
    })
    expect(events).toEqual([])
  })
})
