import jsdoc from 'eslint-plugin-jsdoc'
import tsdoc from 'eslint-plugin-tsdoc'

import baseConfig from './eslint.config.mjs'

export default [
  ...baseConfig,
  {
    files: [
      'prisma.config.ts',
      'src/**/*.ts',
      'scripts/**/*.ts',
      'test/**/*.ts',
    ],
    plugins: {
      jsdoc,
      tsdoc,
    },
    rules: {
      'tsdoc/syntax': 'warn',
    },
  },
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      'jsdoc/require-jsdoc': [
        'warn',
        {
          contexts: ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration'],
          publicOnly: true,
          require: {
            ArrowFunctionExpression: true,
            ClassDeclaration: true,
            FunctionDeclaration: true,
            FunctionExpression: true,
            MethodDefinition: false,
          },
        },
      ],
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      'jsdoc/require-jsdoc': 'off',
    },
  },
]
