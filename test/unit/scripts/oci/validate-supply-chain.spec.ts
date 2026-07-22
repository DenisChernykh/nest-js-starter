import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  type OciPins,
  readOciPins,
  validateSupplyChainFiles,
} from '@scripts/oci/validate-supply-chain'

const pins: OciPins = {
  schemaVersion: 1,
  dockerfileFrontend:
    'docker/dockerfile:1@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89',
  nodeRuntime:
    'node:24.18.0-trixie-slim@sha256:ae91dcc111a68c9d2d81ff2a17bda61be126426176fde6fe7d08ab13b7f50573',
  actions: {
    'actions/checkout': {
      tag: 'v7.0.1',
      sha: '3d3c42e5aac5ba805825da76410c181273ba90b1',
    },
    'docker/build-push-action': {
      tag: 'v7.3.0',
      sha: '53b7df96c91f9c12dcc8a07bcb9ccacbed38856a',
    },
  },
}

const packageJson = {
  devDependencies: {
    yaml: '2.9.0',
  },
}

const dockerfile = `# syntax=${pins.dockerfileFrontend}
ARG NODE_IMAGE=${pins.nodeRuntime}
FROM \${NODE_IMAGE} AS runtime
`

const pullRequestWorkflow = `name: Pull request
on:
  pull_request:
    branches: [stage]
permissions:
  contents: read
jobs:
  full-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
`

const stageWorkflow = `name: Stage image
on:
  push:
    branches: [stage]
permissions:
  contents: read
  packages: write
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a
        with:
          push: true
          tags: ghcr.io/example/starter:\${{ github.sha }}
          sbom: true
          provenance: mode=max,version=v1
`

function validate(
  overrides: {
    readonly dockerfile?: string
    readonly packageJson?: unknown
    readonly workflows?: Readonly<Record<string, string>>
  } = {},
): void {
  validateSupplyChainFiles({
    dockerfile: overrides.dockerfile ?? dockerfile,
    packageJson: overrides.packageJson ?? packageJson,
    pins,
    workflows: overrides.workflows ?? {
      'pull-request.yml': pullRequestWorkflow,
      'stage-image.yml': stageWorkflow,
    },
  })
}

describe('readOciPins', () => {
  it('reads the strict version-one pin contract', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oci-pins-'))
    const path = join(directory, 'oci-pins.json')
    await writeFile(path, `${JSON.stringify(pins)}\n`, 'utf8')

    await expect(readOciPins(path)).resolves.toEqual(pins)
  })

  it('rejects malformed pin documents', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oci-pins-'))
    const path = join(directory, 'oci-pins.json')
    await writeFile(
      path,
      JSON.stringify({ ...pins, schemaVersion: 2, unexpected: true }),
      'utf8',
    )

    await expect(readOciPins(path)).rejects.toThrow('Invalid OCI pins')
  })
})

describe('validateSupplyChainFiles', () => {
  it('accepts exact package, image and workflow pins', () => {
    expect(() => validate()).not.toThrow()
  })

  it.each(['^2.9.0', '~2.9.0', 'latest', '3.0.0-1'])(
    'rejects non-exact or prerelease yaml version %s',
    (version) => {
      expect(() =>
        validate({ packageJson: { devDependencies: { yaml: version } } }),
      ).toThrow('yaml dependency must be exact stable 2.9.0')
    },
  )

  it.each([
    'actions/checkout@v7.0.1',
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b',
  ])('rejects mutable or short action reference %s', (reference) => {
    expect(() =>
      validate({
        workflows: {
          'pull-request.yml': pullRequestWorkflow.replace(
            'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
            reference,
          ),
        },
      }),
    ).toThrow('external action must use an approved 40-character SHA')
  })

  it('rejects an unpinned Dockerfile base', () => {
    expect(() =>
      validate({
        dockerfile: dockerfile.replace(pins.nodeRuntime, 'node:24-trixie-slim'),
      }),
    ).toThrow('Dockerfile base image must be digest-pinned')
  })

  it('rejects pull_request_target workflows', () => {
    expect(() =>
      validate({
        workflows: {
          'pull-request.yml': pullRequestWorkflow.replace(
            'pull_request:',
            'pull_request_target:',
          ),
        },
      }),
    ).toThrow('pull_request_target is forbidden')
  })

  it('rejects write permissions in pull request workflows', () => {
    expect(() =>
      validate({
        workflows: {
          'pull-request.yml': pullRequestWorkflow.replace(
            'contents: read',
            'contents: read\n  packages: write',
          ),
        },
      }),
    ).toThrow('pull request workflow must not grant write permissions')
  })

  it('rejects mutable image tags', () => {
    expect(() =>
      validate({
        workflows: {
          'stage-image.yml': stageWorkflow.replace(
            'ghcr.io/example/starter:${{ github.sha }}',
            'ghcr.io/example/starter:latest',
          ),
        },
      }),
    ).toThrow('published image tag must use github.sha')
  })

  it.each(['sbom: true', 'provenance: mode=max,version=v1'])(
    'rejects build publication missing %s',
    (requiredInput) => {
      expect(() =>
        validate({
          workflows: {
            'stage-image.yml': stageWorkflow.replace(
              `          ${requiredInput}\n`,
              '',
            ),
          },
        }),
      ).toThrow('published image must include SBOM and max provenance')
    },
  )
})
