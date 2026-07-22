import { readFile } from 'node:fs/promises'

import {
  type OciDocumentationInput,
  validateOciDocumentation,
} from '@scripts/oci/validate-supply-chain'

const documentation: OciDocumentationInput = {
  readme: `
node dist/bootstrap/api/main.js
corepack pnpm@11.15.1 run start:migrate
corepack pnpm@11.15.1 run oci:check
ghcr.io/owner/repository@sha256:<64-hex-digest>
Digest references are the only deployment input.
The root docker-compose.yml is local infrastructure, not production deployment.
Update scripts/oci/oci-pins.json only in a reviewed pull request.
Native GitHub artifact attestations for private repositories require GitHub Enterprise Cloud.
`,
  architecture: `
Build arguments are public metadata, never secrets.
SHA tags are non-deployment pointers; the GHCR digest is normative.
BuildKit registry attestations contain the SPDX SBOM and SLSA provenance.
Trivy exceptions are explicit and reviewable.
The stage publisher performs no Dokploy mutation.
`,
  runbook: `
## Gate failure
## Build or push failure
## Scan failure
## Evidence upload failure
## Package permission diagnostics
Safe workflow rerun uses the same commit. Operators must not rebuild for promotion.
corepack pnpm@11.15.1 oci:resolve -- --image ghcr.io/owner/repository --revision <40-hex>
`,
  foundationScope: `
OCI image, PR CI and stage GHCR publication are part of the foundation.
starter.manifest.json remains schema v1 because no current consumer needs OCI fields.
`,
}

const documentationRequirements: Readonly<
  Record<keyof OciDocumentationInput, readonly string[]>
> = {
  readme: [
    'node dist/bootstrap/api/main.js',
    'corepack pnpm@11.15.1 run start:migrate',
    'corepack pnpm@11.15.1 run oci:check',
    '@sha256:',
    'Digest references are the only deployment input',
    'root docker-compose.yml is local infrastructure',
    'scripts/oci/oci-pins.json',
    'private repositories require GitHub Enterprise Cloud',
  ],
  architecture: [
    'Build arguments are public metadata',
    'SHA tags are non-deployment pointers',
    'GHCR digest is normative',
    'BuildKit registry attestations',
    'Trivy exceptions are explicit and reviewable',
    'no Dokploy mutation',
  ],
  runbook: [
    'Gate failure',
    'Build or push failure',
    'Scan failure',
    'Evidence upload failure',
    'Package permission diagnostics',
    'Safe workflow rerun',
    'must not rebuild',
    'oci:resolve',
  ],
  foundationScope: [
    'OCI image, PR CI and stage GHCR publication',
    'starter.manifest.json remains schema v1',
  ],
}

const documentationMutationCases = (
  Object.keys(documentationRequirements) as (keyof OciDocumentationInput)[]
).flatMap((document) =>
  documentationRequirements[document].map(
    (required) => [document, required, documentation[document]] as const,
  ),
)

describe('validateOciDocumentation', () => {
  it('accepts the complete OCI user and operator contract', () => {
    expect(() => validateOciDocumentation(documentation)).not.toThrow()
  })

  it.each(documentationMutationCases)(
    'rejects %s without %s',
    (document, required, source) => {
      expect(() =>
        validateOciDocumentation({
          ...documentation,
          [document]: source.replace(required, 'missing-contract'),
        }),
      ).toThrow('Invalid OCI documentation')
    },
  )

  it('validates the committed OCI documentation', async () => {
    const [readme, architecture, runbook, foundationScope] = await Promise.all([
      readFile('README.md', 'utf8'),
      readFile('docs/architecture/oci-supply-chain.md', 'utf8'),
      readFile('docs/runbooks/stage-image-publication.md', 'utf8'),
      readFile('docs/architecture/foundation-scope.md', 'utf8'),
    ])

    expect(() =>
      validateOciDocumentation({
        readme,
        architecture,
        runbook,
        foundationScope,
      }),
    ).not.toThrow()
  })

  it('runs the OCI image gate after source, contract and coverage gates', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      readonly scripts?: Readonly<Record<string, string>>
    }
    const check = packageJson.scripts?.['check'] ?? ''

    expect(check.indexOf('run test:coverage:run')).toBeGreaterThanOrEqual(0)
    expect(check.indexOf('run oci:check')).toBeGreaterThan(
      check.indexOf('run test:coverage:run'),
    )
    expect(check.endsWith('run oci:check')).toBe(true)
  })

  it('keeps the starter manifest at schema v1 without publication state', async () => {
    const manifest = JSON.parse(
      await readFile('starter.manifest.json', 'utf8'),
    ) as Record<string, unknown>

    expect(manifest['manifestVersion']).toBe(1)
    expect(manifest).not.toHaveProperty('oci')
    expect(manifest).not.toHaveProperty('image')
    expect(manifest).not.toHaveProperty('publication')
  })
})
