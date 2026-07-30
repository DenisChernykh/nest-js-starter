import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { parseDeploymentCliOptions } from './cli-options.js'
import { NodeCommandRunner } from './command-runner.js'
import {
  createDryRunPlan,
  DeploymentExecutionError,
  DeploymentOrchestrator,
} from './deployment-orchestrator.js'
import { DockerDeploymentAdapter } from './docker-deployment.adapter.js'
import { DokployHttpAdapter } from './dokploy-http.adapter.js'
import { EvidenceFileAdapter } from './evidence-file.adapter.js'
import { ExternalSmokeAdapter } from './external-smoke.adapter.js'
import {
  parseDeploymentLiveEnvironment,
  type DeploymentLiveEnvironment,
} from './live-environment.js'
import { DeploymentInputError, readDeploymentManifest } from './manifest.js'

/** Writable process streams used by the deployment CLI boundary. */
export interface DeploymentCliIo {
  readonly stdout: Pick<NodeJS.WriteStream, 'write'>
  readonly stderr: Pick<NodeJS.WriteStream, 'write'>
}

/** Injectable apply composition used to keep offline commands side-effect free. */
export interface DeploymentCliDependencies {
  readonly createOrchestrator: (
    live: DeploymentLiveEnvironment,
  ) => DeploymentOrchestrator
}

/** Process signal boundary used to coordinate graceful CLI interruption. */
export interface DeploymentSignalSource {
  /** Registers a one-shot listener for an operator termination signal. */
  once(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown

  /** Removes a previously registered operator termination listener. */
  off(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
}

function createProductionOrchestrator(
  live: DeploymentLiveEnvironment,
): DeploymentOrchestrator {
  const commandRunner = new NodeCommandRunner()
  const docker = new DockerDeploymentAdapter(commandRunner)
  const dokploy = new DokployHttpAdapter({
    baseUrl: live.dokployBaseUrl,
    apiKey: live.dokployApiKey,
  })
  const smoke = new ExternalSmokeAdapter()
  const evidence = new EvidenceFileAdapter()
  return new DeploymentOrchestrator({
    image: docker,
    migrator: docker,
    dokploy,
    smoke,
    evidence,
    clock: {
      nowMs: () => Date.now(),
      sleep: (milliseconds, signal) =>
        signal === undefined
          ? delay(milliseconds)
          : delay(milliseconds, undefined, { signal }),
    },
  })
}

const productionDependencies: DeploymentCliDependencies = Object.freeze({
  createOrchestrator: createProductionOrchestrator,
})

function writeJson(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  value: unknown,
): void {
  stream.write(`${JSON.stringify(value)}\n`)
}

function writeFailure(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  error: unknown,
): void {
  if (error instanceof DeploymentInputError) {
    writeJson(stream, {
      error: 'input',
      issues: error.issues.map(({ path, rule }) => ({ path, rule })),
    })
    return
  }
  if (error instanceof DeploymentExecutionError) {
    writeJson(stream, {
      error: 'execution',
      step: error.step,
      category: error.category,
    })
    return
  }
  if (error instanceof Error && error.message.startsWith('Usage:')) {
    stream.write(`${error.message}\n`)
    return
  }
  writeJson(stream, { error: 'unexpected' })
}

/**
 * Runs one deployment CLI command without terminating the process.
 *
 * @param arguments_ - Arguments after the script path.
 * @param environment - Process environment used only by explicit apply commands.
 * @param io - Output streams receiving redacted machine-readable messages.
 * @param dependencies - Optional apply composition for tests.
 * @param signal - Optional interruption signal propagated to external operations.
 * @returns Zero on success and one for every handled failure.
 */
export async function runDeploymentCli(
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
  io: DeploymentCliIo,
  dependencies: DeploymentCliDependencies = productionDependencies,
  signal?: AbortSignal,
): Promise<number> {
  try {
    const options = parseDeploymentCliOptions(arguments_)
    const manifest = await readDeploymentManifest(options.manifestPath)

    if (options.command === 'preflight') {
      writeJson(io.stdout, {
        repository: manifest.repository,
        environment: manifest.environment,
        candidate: {
          imageRef: manifest.candidate.imageRef,
          revision: manifest.candidate.revision,
        },
        rollback: {
          imageRef: manifest.rollback.imageRef,
          revision: manifest.rollback.revision,
        },
      })
      return 0
    }

    if (!options.apply) {
      writeJson(io.stdout, {
        operation: 'promote',
        apply: false,
        steps: createDryRunPlan(manifest),
      })
      return 0
    }

    const live = parseDeploymentLiveEnvironment(
      environment,
      manifest.candidate.revision,
      manifest.rollback.revision,
    )
    const orchestrator = dependencies.createOrchestrator(live)
    const evidencePath = options.evidencePath
    if (evidencePath === undefined) {
      throw new DeploymentExecutionError('validate-evidence-path', 'input')
    }
    const input = {
      manifest,
      live,
      evidencePath,
      ...(signal === undefined ? {} : { signal }),
    }
    const evidence =
      options.command === 'promote'
        ? await orchestrator.promote(input)
        : await orchestrator.rollback(input)

    writeJson(io.stdout, {
      operation: evidence.operation,
      outcome: evidence.outcome,
      ...(evidence.deploymentId === undefined
        ? {}
        : { deploymentId: evidence.deploymentId }),
      ...(evidence.terminalStatus === undefined
        ? {}
        : { terminalStatus: evidence.terminalStatus }),
    })
    return 0
  } catch (error) {
    writeFailure(io.stderr, error)
    return 1
  }
}

/**
 * Runs the CLI with graceful SIGINT and SIGTERM coordination.
 *
 * @remarks
 * Signal listeners are installed before command execution. On interruption,
 * the current operation is aborted and this function waits for orchestration
 * restoration, evidence publication and local credential cleanup to settle.
 *
 * @param arguments_ - Arguments after the script path.
 * @param environment - Process environment used only by explicit apply commands.
 * @param io - Output streams receiving redacted machine-readable messages.
 * @param dependencies - Optional apply composition for tests.
 * @param signals - Injectable process signal source.
 * @returns The handled CLI exit code after all cleanup has settled.
 */
export async function runDeploymentCliProcess(
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
  io: DeploymentCliIo,
  dependencies: DeploymentCliDependencies = productionDependencies,
  signals: DeploymentSignalSource = process,
): Promise<number> {
  const controller = new AbortController()
  const abort = (): void => {
    controller.abort()
  }
  signals.once('SIGINT', abort)
  signals.once('SIGTERM', abort)
  try {
    return await runDeploymentCli(
      arguments_,
      environment,
      io,
      dependencies,
      controller.signal,
    )
  } finally {
    signals.off('SIGINT', abort)
    signals.off('SIGTERM', abort)
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === resolve(__filename)) {
  runDeploymentCliProcess(process.argv.slice(2), process.env, {
    stdout: process.stdout,
    stderr: process.stderr,
  })
    .then((exitCode) => {
      process.exitCode = exitCode
    })
    .catch(() => {
      writeJson(process.stderr, { error: 'unexpected' })
      process.exitCode = 1
    })
}
