import { join } from 'node:path'

import { ESLint } from 'eslint'

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
  const [result] = await new ESLint({ cwd: process.cwd() }).lintText(source, {
    filePath,
  })

  return result?.messages.map(({ message }) => message) ?? []
}

describe('application Nest DI boundary', () => {
  it('allows only Inject and Injectable as module application metadata', async () => {
    const messages = await lintApplicationSource(`
      import { Inject, Injectable } from '@nestjs/common'

      interface ExamplePort {
        execute(): void
      }

      const EXAMPLE_PORT = Symbol('EXAMPLE_PORT')

      /** Executes an example through its application port. */
      @Injectable()
      export class ExampleUseCase {
        public constructor(
          @Inject(EXAMPLE_PORT) private readonly port: ExamplePort,
        ) {}

        public execute(): void {
          this.port.execute()
        }
      }
    `)

    expect(messages).toEqual([])
  })

  it.each([
    [
      'Nest HTTP exceptions',
      "import { HttpException } from '@nestjs/common'\nvoid HttpException",
    ],
    [
      'Nest logger',
      "import { Logger } from '@nestjs/common'\nvoid Logger",
    ],
    [
      'Nest configuration',
      "import { ConfigService } from '@nestjs/config'\nvoid ConfigService",
    ],
    [
      'Prisma',
      "import { PrismaClient } from '@prisma/client'\nvoid PrismaClient",
    ],
    [
      'Redis',
      "import Redis from 'ioredis'\nvoid Redis",
    ],
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
        expect.stringContaining('Shared application code must remain framework-free.'),
      ]),
    )
  })
})
