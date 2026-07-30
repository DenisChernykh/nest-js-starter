import { NodeCommandRunner } from '@scripts/deployment/command-runner'

describe('NodeCommandRunner', () => {
  it('passes stdin and merges explicit environment additions with the inherited environment', async () => {
    const runner = new NodeCommandRunner()
    const outcome = await runner.run({
      file: process.execPath,
      arguments: [
        '-e',
        [
          "let input = '';",
          "process.stdin.setEncoding('utf8');",
          "process.stdin.on('data', (chunk) => { input += chunk; });",
          "process.stdin.on('end', () => {",
          '  process.stdout.write(JSON.stringify({',
          '    input,',
          '    inheritedPath: typeof process.env.PATH === "string",',
          '    addition: process.env.DEPLOYMENT_RUNNER_TEST,',
          '  }));',
          '});',
        ].join('\n'),
      ],
      environment: {
        DEPLOYMENT_RUNNER_TEST: 'explicit-addition',
      },
      stdin: 'operator-input',
      timeoutMs: 5_000,
    })

    expect(outcome).toEqual({
      exitCode: 0,
      stdout: JSON.stringify({
        input: 'operator-input',
        inheritedPath: true,
        addition: 'explicit-addition',
      }),
      stderr: '',
      timedOut: false,
    })
  })

  it('returns bounded stdout, stderr and a non-zero exit as data', async () => {
    const runner = new NodeCommandRunner()
    const outcome = await runner.run({
      file: process.execPath,
      arguments: [
        '-e',
        "process.stdout.write('out'); process.stderr.write('err'); process.exit(7);",
      ],
      timeoutMs: 5_000,
    })

    expect(outcome).toEqual({
      exitCode: 7,
      stdout: 'out',
      stderr: 'err',
      timedOut: false,
    })
  })

  it('bounds captured output instead of throwing an unredacted error', async () => {
    const runner = new NodeCommandRunner()
    const outcome = await runner.run({
      file: process.execPath,
      arguments: ['-e', "process.stdout.write('x'.repeat(2 * 1024 * 1024));"],
      timeoutMs: 5_000,
    })

    expect(typeof outcome.exitCode).toBe('number')
    expect(typeof outcome.stdout).toBe('string')
    expect(outcome.stderr).toBe('')
    expect(outcome.timedOut).toBe(false)
    expect(Buffer.byteLength(outcome.stdout)).toBeLessThanOrEqual(1024 * 1024)
  })

  it('terminates a child at the deadline and reports the timeout as data', async () => {
    const runner = new NodeCommandRunner()
    const outcome = await runner.run({
      file: process.execPath,
      arguments: [
        '-e',
        "process.stdout.write('started'); setInterval(() => {}, 1_000);",
      ],
      timeoutMs: 50,
    })

    expect(outcome).toMatchObject({
      stdout: 'started',
      timedOut: true,
    })
    expect(outcome.exitCode).not.toBe(0)
  })

  it('rejects without starting a child when the operation is already aborted', async () => {
    const runner = new NodeCommandRunner()
    const controller = new AbortController()
    controller.abort()

    await expect(
      runner.run({
        file: process.execPath,
        arguments: ['-e', 'process.exit(0)'],
        timeoutMs: 5_000,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
