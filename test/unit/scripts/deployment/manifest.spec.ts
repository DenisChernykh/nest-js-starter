import {
  DeploymentInputError,
  parseDeploymentManifest,
} from '@scripts/deployment/manifest'

const candidateImageRef =
  'ghcr.io/denischernykh/nest-js-starter@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const rollbackImageRef =
  'ghcr.io/denischernykh/nest-js-starter@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

const validManifest = {
  schemaVersion: 1,
  environment: 'stage',
  repository: 'DenisChernykh/nest-js-starter',
  candidate: {
    imageRef: candidateImageRef,
    revision: '1'.repeat(40),
    workflowRunUrl:
      'https://github.com/DenisChernykh/nest-js-starter/actions/runs/123456789',
  },
  rollback: {
    imageRef: rollbackImageRef,
    revision: '2'.repeat(40),
    schemaCompatibilityEvidence: 'review/rollback-compatible',
  },
  publicApiUrl: 'https://stage-api.example.com',
} as const

function captureInputError(input: unknown): DeploymentInputError {
  try {
    parseDeploymentManifest(input)
  } catch (error) {
    if (error instanceof DeploymentInputError) return error
    throw error
  }
  throw new Error('Expected deployment manifest validation to fail')
}

describe('parseDeploymentManifest', () => {
  it('parses and freezes one strict non-secret release manifest', () => {
    const parsed = parseDeploymentManifest(validManifest)

    expect(parsed).toEqual(validManifest)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.candidate)).toBe(true)
    expect(Object.isFrozen(parsed.rollback)).toBe(true)
  })

  it('rejects unknown secret-bearing fields without returning their value', () => {
    const secret = 'postgresql://operator:do-not-print@example.invalid/db'
    const error = captureInputError({
      ...validManifest,
      DATABASE_URL: secret,
    })

    expect(error.issues).toEqual([
      expect.objectContaining({
        path: 'DATABASE_URL',
        rule: 'object.unknown',
      }),
    ])
    expect(JSON.stringify(error)).not.toContain(secret)
    expect(error.message).not.toContain(secret)
  })

  it.each([
    {
      name: 'a mutable image tag',
      input: {
        ...validManifest,
        candidate: {
          ...validManifest.candidate,
          imageRef: 'ghcr.io/denischernykh/nest-js-starter:latest',
        },
      },
      path: 'candidate.imageRef',
    },
    {
      name: 'mixed-case GHCR coordinates',
      input: {
        ...validManifest,
        candidate: {
          ...validManifest.candidate,
          imageRef:
            'ghcr.io/DenisChernykh/nest-js-starter@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      },
      path: 'candidate.imageRef',
    },
    {
      name: 'a credential-bearing public URL',
      input: {
        ...validManifest,
        publicApiUrl: 'https://operator:secret@stage-api.example.com',
      },
      path: 'publicApiUrl',
    },
    {
      name: 'the same candidate and rollback image',
      input: {
        ...validManifest,
        rollback: {
          ...validManifest.rollback,
          imageRef: candidateImageRef,
        },
      },
      path: 'rollback.imageRef',
    },
    {
      name: 'a workflow URL for another repository',
      input: {
        ...validManifest,
        candidate: {
          ...validManifest.candidate,
          workflowRunUrl:
            'https://github.com/DenisChernykh/another-service/actions/runs/123456789',
        },
      },
      path: 'candidate.workflowRunUrl',
    },
  ])('rejects $name', ({ input, path }) => {
    expect(captureInputError(input).issues).toEqual([
      expect.objectContaining({ path }),
    ])
  })
})
