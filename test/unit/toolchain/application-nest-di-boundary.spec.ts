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
const nestedDomainPath = join(
  process.cwd(),
  'src/modules/identity-access/authentication/password/domain/password.ts',
)
const nestedApplicationPath = join(
  process.cwd(),
  'src/modules/identity-access/account-lifecycle/registration/application/register-user.use-case.ts',
)
const nestedPresentationPath = join(
  process.cwd(),
  'src/modules/identity-access/account-lifecycle/registration/presentation/registration.controller.ts',
)
const nestedInfrastructurePath = join(
  process.cwd(),
  'src/modules/identity-access/authentication/password/infrastructure/password-hasher.adapter.ts',
)
const nestedCompositionPath = join(
  process.cwd(),
  'src/modules/identity-access/account-lifecycle/registration/composition/registration.module.ts',
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

  it.each([
    [
      'domain',
      nestedDomainPath,
      "import { Injectable } from '@nestjs/common'\nvoid Injectable",
      'Domain code must remain framework-free.',
    ],
    [
      'application',
      nestedApplicationPath,
      "import { Adapter } from '@/modules/identity-access/authentication/password/infrastructure/password-hasher.adapter'\nvoid Adapter",
      'Application code cannot depend on outer adapters.',
    ],
    [
      'presentation',
      nestedPresentationPath,
      "import { Repository } from '@/modules/identity-access/sessions/infrastructure/session.repository'\nvoid Repository",
      'Presentation calls application contracts',
    ],
    [
      'infrastructure',
      nestedInfrastructurePath,
      "import { Controller } from '@/modules/identity-access/authentication/password/presentation/authentication.controller'\nvoid Controller",
      'Infrastructure implements ports',
    ],
    [
      'composition',
      nestedCompositionPath,
      "import { bootstrap } from '@/bootstrap/api'\nvoid bootstrap",
      'Composition is wired by bootstrap',
    ],
  ])(
    'applies the %s boundary recursively inside nested capabilities',
    async (_layer, filePath, source, expectedMessage) => {
      const messages = await lintApplicationSource(source, filePath)

      expect(messages).toEqual(
        expect.arrayContaining([expect.stringContaining(expectedMessage)]),
      )
    },
  )
})
