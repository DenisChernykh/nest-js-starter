import {
  link,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EvidenceFileAdapter,
  EvidenceFileError,
} from '@scripts/deployment/evidence-file.adapter'
import type { DeploymentEvidence } from '@scripts/deployment/ports'

const evidence: DeploymentEvidence = {
  schemaVersion: 1,
  operation: 'promote',
  environment: 'stage',
  repository: 'DenisChernykh/nest-js-starter',
  candidate: {
    imageRef:
      'ghcr.io/denischernykh/nest-js-starter@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    revision: '1'.repeat(40),
  },
  rollback: {
    imageRef:
      'ghcr.io/denischernykh/nest-js-starter@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    revision: '2'.repeat(40),
  },
  workflowRunUrl:
    'https://github.com/DenisChernykh/nest-js-starter/actions/runs/123456789',
  startedAt: '2026-07-30T10:00:00.000Z',
  finishedAt: '2026-07-30T10:01:00.000Z',
  steps: [
    {
      name: 'external-smoke',
      outcome: 'succeeded',
      completedAt: '2026-07-30T10:01:00.000Z',
    },
  ],
  deploymentId: 'deployment-1',
  terminalStatus: 'done',
  migrationOutcome: 'succeeded',
  restorationAttempted: false,
  restorationSucceeded: false,
  smoke: {
    live: true,
    startup: true,
    ready: true,
    unauthenticatedAuthProblem: true,
  },
  outcome: 'succeeded',
}

async function temporarySiblings(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((name) =>
    name.startsWith('.deployment-evidence-'),
  )
}

describe('EvidenceFileAdapter', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'nest-js-starter-evidence-test-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('publishes canonical mode-0600 JSON through an injected hard link', async () => {
    const links: Readonly<{ source: string; destination: string }>[] = []
    const adapter = new EvidenceFileAdapter({
      linkImplementation: (source, destination) => {
        links.push({ source, destination })
        return link(source, destination)
      },
    })
    const destination = join(directory, 'promotion.json')

    await adapter.write(destination, evidence)

    expect(await readFile(destination, 'utf8')).toBe(
      `${JSON.stringify(evidence, null, 2)}\n`,
    )
    expect((await stat(destination)).mode & 0o777).toBe(0o600)
    expect(links).toHaveLength(1)
    expect(links[0]?.destination).toBe(destination)
    expect(await temporarySiblings(directory)).toEqual([])
  })

  it('refuses to overwrite an existing destination', async () => {
    const destination = join(directory, 'promotion.json')
    const adapter = new EvidenceFileAdapter()

    await adapter.write(destination, evidence)
    await expect(adapter.write(destination, evidence)).rejects.toMatchObject({
      name: 'EvidenceFileError',
      code: 'EVIDENCE_EXISTS',
    })
    expect(await readFile(destination, 'utf8')).toBe(
      `${JSON.stringify(evidence, null, 2)}\n`,
    )
    expect(await temporarySiblings(directory)).toEqual([])
  })

  it('does not replace an existing path when the injected link reports EEXIST', async () => {
    const destination = join(directory, 'promotion.json')
    await writeFile(destination, 'existing\n', 'utf8')
    const links: string[] = []
    const adapter = new EvidenceFileAdapter({
      linkImplementation: (source, target) => {
        links.push(`${source}->${target}`)
        return link(source, target)
      },
    })

    await expect(adapter.write(destination, evidence)).rejects.toEqual(
      expect.objectContaining({
        name: 'EvidenceFileError',
        code: 'EVIDENCE_EXISTS',
      }),
    )
    expect(links).toHaveLength(1)
    expect(await readFile(destination, 'utf8')).toBe('existing\n')
    expect(await temporarySiblings(directory)).toEqual([])
  })

  it('rejects forbidden secret-bearing keys before serialization', async () => {
    const destination = join(directory, 'promotion.json')
    const sentinel = 'sentinel-registry-secret'
    const unsafeEvidence = {
      ...evidence,
      password: sentinel,
    } as DeploymentEvidence
    const adapter = new EvidenceFileAdapter()

    let failure: unknown
    try {
      await adapter.write(destination, unsafeEvidence)
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(EvidenceFileError)
    expect(JSON.stringify(failure)).not.toContain(sentinel)
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await temporarySiblings(directory)).toEqual([])
  })

  it('cleans the temporary sibling after serialization or write failure', async () => {
    const serializationDestination = join(directory, 'serialization.json')
    const unserializable = {
      ...evidence,
      extraValue: 1n,
    } as unknown as DeploymentEvidence
    const serializationAdapter = new EvidenceFileAdapter()

    await expect(
      serializationAdapter.write(serializationDestination, unserializable),
    ).rejects.toMatchObject({ code: 'EVIDENCE_SERIALIZATION' })
    await expect(stat(serializationDestination)).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(await temporarySiblings(directory)).toEqual([])

    const writeDestination = join(directory, 'write.json')
    const writeAdapter = new EvidenceFileAdapter({
      writeImplementation: () =>
        Promise.reject(new Error('sentinel-private-write-error')),
    })
    let failure: unknown
    try {
      await writeAdapter.write(writeDestination, evidence)
    } catch (error) {
      failure = error
    }

    expect(failure).toEqual(
      expect.objectContaining({
        name: 'EvidenceFileError',
        code: 'EVIDENCE_WRITE',
      }),
    )
    expect(JSON.stringify(failure)).not.toContain(
      'sentinel-private-write-error',
    )
    await expect(stat(writeDestination)).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(await temporarySiblings(directory)).toEqual([])
  })
})
