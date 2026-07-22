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
})
