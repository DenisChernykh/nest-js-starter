import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
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
# check=error=true

ARG NODE_IMAGE=${pins.nodeRuntime}

FROM \${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store corepack pnpm@11.15.1 install --frozen-lockfile --store-dir=/pnpm/store

FROM dependencies AS build
COPY . .
RUN corepack pnpm@11.15.1 run build && CI=true corepack pnpm@11.15.1 prune --prod

FROM \${NODE_IMAGE} AS runtime
ARG BUILD_REVISION
ARG BUILD_SOURCE
ARG BUILD_CREATED
RUN corepack install --global pnpm@11.15.1
RUN node -e 'const [revision, source] = process.argv.slice(1); if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error("BUILD_REVISION must be 40 lowercase hex"); const url = new URL(source); if (url.protocol !== "https:" || url.username !== "" || url.password !== "") throw new Error("BUILD_SOURCE must be a credential-free HTTPS URL")' "$BUILD_REVISION" "$BUILD_SOURCE"
LABEL org.opencontainers.image.title="nest-js-starter" org.opencontainers.image.source="\${BUILD_SOURCE}" org.opencontainers.image.revision="\${BUILD_REVISION}" org.opencontainers.image.created="\${BUILD_CREATED}"
ENV NODE_ENV=production API_HOST=0.0.0.0 pnpm_config_verify_deps_before_run=false
WORKDIR /app
COPY --chown=node:node --from=build /app/package.json ./package.json
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/prisma ./prisma
COPY --chown=node:node --from=build /app/prisma.config.ts ./prisma.config.ts
USER node
EXPOSE 3000
CMD ["node", "dist/bootstrap/api/main.js"]
`

const dockerignore = `.git
.github
.env*
node_modules
.pnpm-store
dist
coverage
*.log
.DS_Store
.idea
.vscode
test
*.tsbuildinfo
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
    readonly dockerignore?: string
    readonly packageJson?: unknown
    readonly workflows?: Readonly<Record<string, string>>
  } = {},
): void {
  validateSupplyChainFiles({
    dockerfile: overrides.dockerfile ?? dockerfile,
    dockerignore: overrides.dockerignore ?? dockerignore,
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

  it.each(['dependencies', 'build', 'runtime'])(
    'rejects a Dockerfile missing the %s stage',
    (stage) => {
      expect(() =>
        validate({
          dockerfile: dockerfile.replace(
            ` AS ${stage}`,
            ` AS missing-${stage}`,
          ),
        }),
      ).toThrow('Dockerfile must define dependencies, build and runtime stages')
    },
  )

  it.each(['install --frozen-lockfile', 'run build', 'prune --prod'])(
    'rejects a Dockerfile missing %s',
    (command) => {
      expect(() =>
        validate({
          dockerfile: dockerfile.replace(command, 'missing-command'),
        }),
      ).toThrow('Dockerfile install/build/prune contract is incomplete')
    },
  )

  it('requires non-interactive production pruning', () => {
    expect(() =>
      validate({ dockerfile: dockerfile.replace('CI=true', 'CI=false') }),
    ).toThrow('Dockerfile install/build/prune contract is incomplete')
  })

  it('disables pnpm runtime dependency auto-install', () => {
    expect(() =>
      validate({
        dockerfile: dockerfile.replace(
          'pnpm_config_verify_deps_before_run=false',
          'PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false',
        ),
      }),
    ).toThrow('Dockerfile runtime pnpm policy is incomplete')
  })

  it.each([
    '/app/package.json',
    '/app/node_modules',
    '/app/dist',
    '/app/prisma',
    '/app/prisma.config.ts',
  ])('rejects a runtime image missing %s', (path) => {
    expect(() =>
      validate({ dockerfile: dockerfile.replace(path, '/app/missing') }),
    ).toThrow('Dockerfile runtime contents are incomplete')
  })

  it('rejects incomplete OCI metadata labels', () => {
    expect(() =>
      validate({
        dockerfile: dockerfile.replace(
          'org.opencontainers.image.revision',
          'invalid.revision',
        ),
      }),
    ).toThrow('Dockerfile OCI metadata contract is incomplete')
  })

  it.each([
    'BUILD_REVISION must be 40 lowercase hex',
    'BUILD_SOURCE must be a credential-free HTTPS URL',
  ])('rejects missing build metadata validation for %s', (message) => {
    expect(() =>
      validate({ dockerfile: dockerfile.replace(message, 'missing-check') }),
    ).toThrow('Dockerfile must validate public metadata inputs during build')
  })

  it.each([
    ['USER node', 'USER root'],
    [
      'CMD ["node", "dist/bootstrap/api/main.js"]',
      'CMD node dist/bootstrap/api/main.js',
    ],
  ])(
    'rejects an unsafe runtime instruction replacing %s',
    (expected, unsafe) => {
      expect(() =>
        validate({ dockerfile: dockerfile.replace(expected, unsafe) }),
      ).toThrow('Dockerfile must run as non-root with exec-form API command')
    },
  )

  it('rejects source copied into the runtime stage', () => {
    expect(() =>
      validate({
        dockerfile: dockerfile.replace(
          'USER node',
          'COPY --from=build /app/src ./src\nUSER node',
        ),
      }),
    ).toThrow('Dockerfile runtime stage must not copy forbidden paths')
  })

  it.each(['.git', '.env*', 'node_modules', 'dist', 'coverage', 'test'])(
    'rejects a dockerignore missing %s',
    (entry) => {
      expect(() =>
        validate({
          dockerignore: dockerignore
            .split('\n')
            .filter((line) => line !== entry)
            .join('\n'),
        }),
      ).toThrow('Docker ignore policy is incomplete')
    },
  )

  it('validates the committed Dockerfile and dockerignore', async () => {
    const [committedDockerfile, committedDockerignore] = await Promise.all([
      readFile('Dockerfile', 'utf8'),
      readFile('.dockerignore', 'utf8'),
    ])

    expect(() =>
      validate({
        dockerfile: committedDockerfile,
        dockerignore: committedDockerignore,
        workflows: {},
      }),
    ).not.toThrow()
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
