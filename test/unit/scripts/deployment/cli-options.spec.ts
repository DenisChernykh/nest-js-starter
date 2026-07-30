import { parseDeploymentCliOptions } from '@scripts/deployment/cli-options'

describe('parseDeploymentCliOptions', () => {
  it('parses an offline promotion dry-run', () => {
    expect(
      parseDeploymentCliOptions(['promote', '--manifest', 'release.json']),
    ).toEqual({
      command: 'promote',
      manifestPath: 'release.json',
      apply: false,
    })
  })

  it('parses an explicit promotion apply with evidence', () => {
    expect(
      parseDeploymentCliOptions([
        'promote',
        '--manifest',
        'release.json',
        '--apply',
        '--evidence',
        'evidence.json',
      ]),
    ).toEqual({
      command: 'promote',
      manifestPath: 'release.json',
      apply: true,
      evidencePath: 'evidence.json',
    })
  })

  it('accepts the single pnpm argument separator', () => {
    expect(
      parseDeploymentCliOptions([
        '--',
        'preflight',
        '--manifest',
        'release.json',
      ]),
    ).toEqual({
      command: 'preflight',
      manifestPath: 'release.json',
      apply: false,
    })
  })

  it.each([
    {
      name: 'rollback without apply',
      arguments_: ['rollback', '--manifest', 'release.json'],
    },
    {
      name: 'apply without evidence',
      arguments_: ['promote', '--manifest', 'release.json', '--apply'],
    },
    {
      name: 'evidence without apply',
      arguments_: [
        'promote',
        '--manifest',
        'release.json',
        '--evidence',
        'evidence.json',
      ],
    },
    {
      name: 'preflight apply',
      arguments_: [
        'preflight',
        '--manifest',
        'release.json',
        '--apply',
        '--evidence',
        'evidence.json',
      ],
    },
    {
      name: 'a secret-valued token flag',
      arguments_: [
        'promote',
        '--manifest',
        'release.json',
        '--token',
        'secret',
      ],
    },
    {
      name: 'a secret-valued database flag',
      arguments_: [
        'promote',
        '--manifest',
        'release.json',
        '--database-url',
        'postgresql://example.invalid/db',
      ],
    },
    {
      name: 'a duplicate manifest flag',
      arguments_: [
        'promote',
        '--manifest',
        'release.json',
        '--manifest',
        'other.json',
      ],
    },
    {
      name: 'a positional extra',
      arguments_: ['promote', '--manifest', 'release.json', 'extra'],
    },
  ])('rejects $name', ({ arguments_ }) => {
    expect(() => parseDeploymentCliOptions(arguments_)).toThrow('Usage:')
  })
})
