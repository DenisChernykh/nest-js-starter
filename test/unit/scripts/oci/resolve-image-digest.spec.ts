import {
  resolveExistingImage,
  serializeResolvedImage,
  type ImageInspectCommand,
} from '@scripts/oci/resolve-image-digest'

const image = 'ghcr.io/denischernykh/nest-js-starter'
const revision = '0123456789abcdef0123456789abcdef01234567'
const digest =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function createCommand(
  manifest: unknown = { digest },
  imageConfig: unknown = {
    config: {
      Labels: {
        'org.opencontainers.image.revision': revision,
      },
    },
  },
): {
  readonly calls: string[][]
  readonly command: ImageInspectCommand
} {
  const calls: string[][] = []
  const command: ImageInspectCommand = (file, arguments_) => {
    calls.push([file, ...arguments_])
    return Promise.resolve({
      stdout: JSON.stringify(calls.length === 1 ? manifest : imageConfig),
    })
  }
  return { calls, command }
}

describe('resolveExistingImage', () => {
  it('resolves an existing SHA tag to its verified digest reference', async () => {
    const { calls, command } = createCommand()

    await expect(
      resolveExistingImage({ image, revision }, command),
    ).resolves.toEqual({
      image,
      digest,
      reference: `${image}@${digest}`,
      revision,
    })
    expect(calls).toEqual([
      [
        'docker',
        'buildx',
        'imagetools',
        'inspect',
        `${image}:${revision}`,
        '--format',
        '{{json .Manifest}}',
      ],
      [
        'docker',
        'buildx',
        'imagetools',
        'inspect',
        `${image}@${digest}`,
        '--format',
        '{{json .Image}}',
      ],
    ])
  })

  it.each([
    ['', revision],
    ['docker.io/example/starter', revision],
    ['ghcr.io/Owner/starter', revision],
    [`${image}:latest`, revision],
    [`${image}@${digest}`, revision],
    [image, 'main'],
    [image, revision.toUpperCase()],
  ])('rejects invalid image or revision %j %j', async (candidate, sha) => {
    const { calls, command } = createCommand()

    await expect(
      resolveExistingImage({ image: candidate, revision: sha }, command),
    ).rejects.toThrow('Invalid image resolver input')
    expect(calls).toHaveLength(0)
  })

  it.each([
    ['missing digest', {}],
    ['malformed digest', { digest: 'sha256:abc' }],
    ['mutable digest field', { digest: `${digest}:latest` }],
    ['empty response', ''],
    ['invalid JSON', 'not-json'],
  ])('rejects %s in the manifest response', async (_name, manifest) => {
    const { command } = createCommand(manifest)

    await expect(
      resolveExistingImage({ image, revision }, command),
    ).rejects.toThrow('Invalid registry manifest')
  })

  it.each([
    {},
    { config: {} },
    { config: { Labels: {} } },
    {
      config: {
        Labels: { 'org.opencontainers.image.revision': 'f'.repeat(40) },
      },
    },
  ])('rejects missing or mismatched revision label %j', async (imageConfig) => {
    const { command } = createCommand({ digest }, imageConfig)

    await expect(
      resolveExistingImage({ image, revision }, command),
    ).rejects.toThrow('Image revision label does not match requested revision')
  })

  it('does not fall back when the SHA tag is missing', async () => {
    const command: ImageInspectCommand = () =>
      Promise.reject(new Error('manifest unknown'))

    await expect(
      resolveExistingImage({ image, revision }, command),
    ).rejects.toThrow('Existing image inspection failed')
  })

  it('serializes plain and JSON output without extra registry operations', async () => {
    const { command } = createCommand()
    const resolved = await resolveExistingImage({ image, revision }, command)

    expect(serializeResolvedImage(resolved, false)).toBe(`${image}@${digest}\n`)
    expect(serializeResolvedImage(resolved, true)).toBe(
      `${JSON.stringify(resolved)}\n`,
    )
  })
})
