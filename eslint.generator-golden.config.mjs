import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import jsdoc from 'eslint-plugin-jsdoc'
import tsdoc from 'eslint-plugin-tsdoc'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const goldenFiles = ['test/fixtures/module-generator/expected/**/*.ts']

export default tseslint.config(
  {
    ...js.configs.recommended,
    files: goldenFiles,
  },
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: goldenFiles,
  })),
  {
    files: goldenFiles,
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        project: ['./test/fixtures/module-generator/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      jsdoc,
      tsdoc,
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
        },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: ['@test/**'],
        },
      ],
      'tsdoc/syntax': 'error',
    },
  },
  {
    files: ['test/fixtures/module-generator/expected/src/**/*.ts'],
    rules: {
      'jsdoc/require-jsdoc': [
        'error',
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
  prettier,
)
