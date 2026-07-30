import { readFile } from 'node:fs/promises'

import { parse } from 'yaml'

interface WorkflowStep {
  readonly name?: string
  readonly run?: string
  readonly uses?: string
  readonly with?: Readonly<Record<string, unknown>>
}

interface WorkflowDocument {
  readonly jobs?: Readonly<
    Record<string, { readonly steps?: readonly WorkflowStep[] }>
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
  const workflow = parse(await readFile(path, 'utf8')) as WorkflowDocument
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

describe('CI workflow Docker Compose contract', () => {
  it('pins the supported Compose release before every full gate', async () => {
    await expect(
      projectComposeSetup('.github/workflows/pull-request.yml', 'full-gate'),
    ).resolves.toEqual(composeSetup)
    await expect(
      projectComposeSetup('.github/workflows/stage-image.yml', 'gate'),
    ).resolves.toEqual(composeSetup)
  })
})
