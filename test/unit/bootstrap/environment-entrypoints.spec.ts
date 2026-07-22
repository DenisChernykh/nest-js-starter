import { readFileSync } from 'node:fs'

describe('runtime environment entrypoints', () => {
  it.each(['src/bootstrap/api/main.ts', 'src/bootstrap/admin/main.ts'])(
    'loads dotenv before the runtime graph in %s',
    (path) => {
      expect(readFileSync(path, 'utf8').trimStart()).toMatch(
        /^import 'dotenv\/config'/u,
      )
    },
  )

  it('keeps admin command results separate from audit diagnostics', () => {
    const source = readFileSync('src/bootstrap/admin/main.ts', 'utf8')

    expect(source).toMatch(
      /new PinoLogSink\(config,\s*\{\s*destination: process\.stderr,?\s*\}\)/u,
    )
    expect(source).toContain(
      'writeOutput: (message) => process.stdout.write(message)',
    )
    expect(source).toContain(
      'writeError: (message) => process.stderr.write(message)',
    )
  })
})
