import {
  assertImageTagAvailable,
  type ImageTagInspectCommand,
} from '@scripts/oci/assert-image-tag-available'

const image = 'ghcr.io/denischernykh/nest-js-starter'
const revision = '0123456789abcdef0123456789abcdef01234567'

describe('assertImageTagAvailable', () => {
  it('accepts a registry-confirmed missing SHA tag', async () => {
    const calls: string[][] = []
    const command: ImageTagInspectCommand = (file, arguments_) => {
      calls.push([file, ...arguments_])
      return Promise.reject(new Error('manifest unknown'))
    }

    await expect(
      assertImageTagAvailable({ image, revision }, command),
    ).resolves.toBeUndefined()
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
    ])
  })

  it.each(['not found', 'name unknown'])(
    'accepts the missing-tag registry response %j',
    async (message) => {
      const command: ImageTagInspectCommand = () =>
        Promise.reject(new Error(message))

      await expect(
        assertImageTagAvailable({ image, revision }, command),
      ).resolves.toBeUndefined()
    },
  )

  it('rejects an existing SHA tag before publication', async () => {
    const command: ImageTagInspectCommand = () =>
      Promise.resolve({ stdout: '{"digest":"sha256:fixture"}' })

    await expect(
      assertImageTagAvailable({ image, revision }, command),
    ).rejects.toThrow('Image SHA tag already exists')
  })

  it('fails closed on an unexpected registry error', async () => {
    const command: ImageTagInspectCommand = () =>
      Promise.reject(new Error('registry timeout'))

    await expect(
      assertImageTagAvailable({ image, revision }, command),
    ).rejects.toThrow('Image tag availability check failed')
  })

  it.each([
    ['docker.io/example/starter', revision],
    ['ghcr.io/Owner/starter', revision],
    [image, 'main'],
  ])('rejects invalid input %j %j', async (candidate, sha) => {
    const command = jest.fn<
      ReturnType<ImageTagInspectCommand>,
      Parameters<ImageTagInspectCommand>
    >()

    await expect(
      assertImageTagAvailable({ image: candidate, revision: sha }, command),
    ).rejects.toThrow('Invalid image tag input')
    expect(command).not.toHaveBeenCalled()
  })
})
