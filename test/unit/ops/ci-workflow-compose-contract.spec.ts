import { readFile } from 'node:fs/promises'

import { parse } from 'yaml'

interface WorkflowStep {
  readonly name?: string
  readonly run?: string
  readonly uses?: string
  readonly with?: Readonly<Record<string, unknown>>
}

interface WorkflowDocument {
  readonly on?: Readonly<
    Record<string, { readonly branches?: readonly string[] }>
  >
  readonly jobs?: Readonly<
    Record<
      string,
      {
        readonly if?: string
        readonly needs?: string
        readonly permissions?: Readonly<Record<string, string>>
        readonly steps?: readonly WorkflowStep[]
      }
    >
  >
}

const composeSetup = Object.freeze({
  uses: 'docker/setup-compose-action@4eb059ff7f16592f9c84d5ca339c53cb7c5064e2',
  version: 'v2.39.4',
  beforeFullGate: true,
})

async function projectComposeSetup(
  path: string,
  jobName: string,
): Promise<
  | Readonly<{
      uses: string | undefined
      version: unknown
      beforeFullGate: boolean
    }>
  | undefined
> {
  const workflow = await readWorkflow(path)
  const steps = workflow.jobs?.[jobName]?.steps ?? []
  const setupIndex = steps.findIndex(
    ({ name }) => name === 'Setup Docker Compose',
  )
  if (setupIndex === -1) return undefined

  const fullGateIndex = steps.findIndex(({ run }) =>
    run?.includes('pnpm@11.15.1 run check'),
  )
  const setup = steps[setupIndex]!
  return Object.freeze({
    uses: setup.uses,
    version: setup.with?.version,
    beforeFullGate: fullGateIndex !== -1 && setupIndex < fullGateIndex,
  })
}

async function readWorkflow(path: string): Promise<WorkflowDocument> {
  return parse(await readFile(path, 'utf8')) as WorkflowDocument
}

async function projectPublishComposeSetup(path: string): Promise<
  | Readonly<{
      uses: string | undefined
      version: unknown
      beforeImageSmoke: boolean
    }>
  | undefined
> {
  const workflow = await readWorkflow(path)
  const steps = workflow.jobs?.publish?.steps ?? []
  const setupIndex = steps.findIndex(
    ({ name }) => name === 'Setup Docker Compose',
  )
  if (setupIndex === -1) return undefined

  const smokeIndex = steps.findIndex(({ run }) =>
    run?.includes('scripts/oci/run-image-smoke.ts'),
  )
  const setup = steps[setupIndex]!
  return Object.freeze({
    uses: setup.uses,
    version: setup.with?.version,
    beforeImageSmoke: smokeIndex !== -1 && setupIndex < smokeIndex,
  })
}

describe('CI workflow Docker Compose contract', () => {
  it('pins the supported Compose release before every full gate', async () => {
    await expect(
      projectComposeSetup('.github/workflows/pull-request.yml', 'full-gate'),
    ).resolves.toEqual(composeSetup)
    await expect(
      projectComposeSetup('.github/workflows/stage-image.yml', 'gate'),
    ).resolves.toEqual(composeSetup)
  })

  it('pins the supported Compose release before published image smoke', async () => {
    await expect(
      projectPublishComposeSetup('.github/workflows/stage-image.yml'),
    ).resolves.toEqual({
      uses: 'docker/setup-compose-action@4eb059ff7f16592f9c84d5ca339c53cb7c5064e2',
      version: 'v2.39.4',
      beforeImageSmoke: true,
    })
  })

  it('runs the exact image pipeline for stage pushes and pull requests', async () => {
    const workflow = await readWorkflow('.github/workflows/stage-image.yml')

    expect(workflow.on).toEqual({
      pull_request: { branches: ['stage'] },
      push: { branches: ['stage'] },
    })
  })

  it('publishes only stage pushes and trusted same-repository pull requests', async () => {
    const workflow = await readWorkflow('.github/workflows/stage-image.yml')

    expect(workflow.jobs?.publish).toMatchObject({
      if: "github.event_name == 'push' || (github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && github.actor != 'dependabot[bot]')",
      needs: 'gate',
      permissions: {
        contents: 'read',
        packages: 'write',
      },
    })
  })
})
