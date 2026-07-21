import { resolve } from 'node:path'

import rootConfig from './.dependency-cruiser.cjs'

export default {
  ...rootConfig,
  options: {
    ...rootConfig.options,
    baseDir: resolve(
      import.meta.dirname,
      'test/fixtures/module-generator/expected',
    ),
    tsConfig: {
      fileName: resolve(
        import.meta.dirname,
        'test/fixtures/module-generator/tsconfig.json',
      ),
    },
  },
}
