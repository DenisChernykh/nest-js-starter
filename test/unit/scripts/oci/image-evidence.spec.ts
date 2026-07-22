import { readFile } from 'node:fs/promises'

import {
  createDigestReference,
  createImageEvidence,
  normalizeGhcrImage,
  serializeImageEvidence,
} from '@scripts/oci/write-image-evidence'
import {
  readRegistryAttestations,
  type RegistryInspectCommand,
} from '@scripts/oci/read-registry-attestations'

const revision = '0123456789abcdef0123456789abcdef01234567'
const digest =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const image = 'ghcr.io/denischernykh/nest-js-starter'
const openapi = '{"openapi":"3.1.0"}\n'

describe('image evidence', () => {
  it('normalizes a GitHub repository to a lowercase GHCR image', () => {
    expect(normalizeGhcrImage('DenisChernykh/Nest-JS-Starter')).toBe(image)
  })

  it.each([
    '',
    'owner',
    'owner/repository/extra',
    'owner/repository:latest',
    'owner/repository@sha256:abc',
    'owner/repository name',
  ])('rejects invalid GitHub repository %j', (repository) => {
    expect(() => normalizeGhcrImage(repository)).toThrow(
      'Invalid GitHub repository',
    )
  })

  it('constructs the canonical immutable digest reference', () => {
    expect(createDigestReference(image, digest)).toBe(`${image}@${digest}`)
  })

  it.each([
    ['ghcr.io/DenisChernykh/nest-js-starter', digest],
    [`${image}:latest`, digest],
    [image, 'sha256:abc'],
    [image, `sha512:${'a'.repeat(64)}`],
  ])(
    'rejects invalid image or digest %j %j',
    (candidateImage, candidateDigest) => {
      expect(() =>
        createDigestReference(candidateImage, candidateDigest),
      ).toThrow('Invalid immutable image input')
    },
  )

  it('hashes OpenAPI and serializes deterministic evidence', () => {
    const evidence = createImageEvidence({
      digest,
      image,
      openapi,
      revision,
    })

    expect(evidence).toEqual({
      schemaVersion: 1,
      image,
      digest,
      reference: `${image}@${digest}`,
      revision,
      openapiSha256:
        '7927cf5b451b44fb947646f0e189a8b41ed29b043923cf030c42d00da8a3b072',
    })
    expect(serializeImageEvidence(evidence)).toBe(
      `${JSON.stringify(evidence, null, 2)}\n`,
    )
    expect(serializeImageEvidence(evidence)).toBe(
      serializeImageEvidence(
        createImageEvidence({ digest, image, openapi, revision }),
      ),
    )
  })

  it.each([
    { revision: 'main' },
    { revision: revision.toUpperCase() },
    { digest: 'sha256:abc' },
    { image: 'docker.io/example/starter' },
  ])('rejects invalid evidence input %j', (override) => {
    expect(() =>
      createImageEvidence({
        digest,
        image,
        openapi,
        revision,
        ...override,
      }),
    ).toThrow('Invalid image evidence input')
  })
})

describe('registry attestations', () => {
  it('reads captured Buildx SPDX and SLSA documents from the digest', async () => {
    const [sbom, provenance] = await Promise.all([
      readFile('test/fixtures/oci/buildx-sbom.spdx.json', 'utf8'),
      readFile('test/fixtures/oci/buildx-provenance.slsa.json', 'utf8'),
    ])
    const calls: string[][] = []
    const command: RegistryInspectCommand = (file, arguments_) => {
      calls.push([file, ...arguments_])
      return Promise.resolve(
        arguments_.at(-1) === '{{json .SBOM.SPDX}}'
          ? { stdout: sbom }
          : { stdout: provenance },
      )
    }

    await expect(
      readRegistryAttestations(`${image}@${digest}`, command),
    ).resolves.toEqual({
      sbom: JSON.parse(sbom) as unknown,
      provenance: JSON.parse(provenance) as unknown,
    })
    expect(calls).toEqual([
      [
        'docker',
        'buildx',
        'imagetools',
        'inspect',
        `${image}@${digest}`,
        '--format',
        '{{json .SBOM.SPDX}}',
      ],
      [
        'docker',
        'buildx',
        'imagetools',
        'inspect',
        `${image}@${digest}`,
        '--format',
        '{{json .Provenance.SLSA}}',
      ],
    ])
  })

  it.each(['', 'null', '[]', '{}', 'not-json'])(
    'rejects empty or malformed registry data %j',
    async (stdout) => {
      const command: RegistryInspectCommand = () => Promise.resolve({ stdout })

      await expect(
        readRegistryAttestations(`${image}@${digest}`, command),
      ).rejects.toThrow('Invalid registry attestation')
    },
  )

  it('rejects a mutable registry reference before invoking Docker', async () => {
    const command = jest.fn<
      ReturnType<RegistryInspectCommand>,
      Parameters<RegistryInspectCommand>
    >()

    await expect(
      readRegistryAttestations(`${image}:latest`, command),
    ).rejects.toThrow('Invalid immutable image input')
    expect(command).not.toHaveBeenCalled()
  })
})
