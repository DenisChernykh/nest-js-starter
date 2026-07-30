import { join } from 'node:path'

import { ESLint, Linter } from 'eslint'

const moduleApplicationPath = join(
  process.cwd(),
  'src/modules/auth/application/login.use-case.ts',
)
const sharedApplicationPath = join(
  process.cwd(),
  'src/shared/application/transaction.port.ts',
)

async function lintApplicationSource(
  source: string,
  filePath = moduleApplicationPath,
): Promise<readonly string[]> {
  const eslint = new ESLint({ cwd: process.cwd() })
  const config = (await eslint.calculateConfigForFile(filePath)) as unknown as {
    readonly rules?: Readonly<Record<string, Linter.RuleEntry>>
  }
  const restriction = config?.rules?.['no-restricted-imports']
  if (restriction === undefined)
    throw new Error(`Missing no-restricted-imports config for ${filePath}`)

  return new Linter({ configType: 'flat' })
    .verify(source, {
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      rules: {
        'no-restricted-imports': restriction,
      },
    })
    .map(({ message }) => message)
}

describe('application Nest DI boundary', () => {
  it('allows only Inject and Injectable as module application metadata', async () => {
    const messages = await lintApplicationSource(`
      import { Inject, Injectable } from '@nestjs/common'
      void Inject
      void Injectable
    `)

    expect(messages).toEqual([])
  })

  it.each([
    [
      'Nest HTTP exceptions',
      "import { HttpException } from '@nestjs/common'\nvoid HttpException",
    ],
    ['Nest logger', "import { Logger } from '@nestjs/common'\nvoid Logger"],
    [
      'Nest configuration',
      "import { ConfigService } from '@nestjs/config'\nvoid ConfigService",
    ],
    [
      'Prisma',
      "import { PrismaClient } from '@prisma/client'\nvoid PrismaClient",
    ],
    ['Redis', "import Redis from 'ioredis'\nvoid Redis"],
    [
      'outer adapters',
      "import { Adapter } from '@/modules/auth/infrastructure/adapter'\nvoid Adapter",
    ],
  ])('rejects %s in module application code', async (_name, source) => {
    const messages = await lintApplicationSource(source)

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Application code|application code/u),
      ]),
    )
  })

  it('keeps shared application fully framework-free', async () => {
    const messages = await lintApplicationSource(
      "import { Injectable } from '@nestjs/common'\nvoid Injectable",
      sharedApplicationPath,
    )

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'Shared application code must remain framework-free.',
        ),
      ]),
    )
  })
})
