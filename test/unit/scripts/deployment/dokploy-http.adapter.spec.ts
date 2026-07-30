import { createServer } from 'node:http'
import type { IncomingMessage, Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import {
  DokployContractError,
  DokployHttpAdapter,
} from '@scripts/deployment/dokploy-http.adapter'

interface CapturedRequest {
  readonly method: string
  readonly path: string
  readonly apiKey?: string
  readonly body?: unknown
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.once('end', () => resolve(body))
    request.once('error', reject)
  })
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve((server.address() as AddressInfo).port)
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })
}

function createFetchBridge(loopbackOrigin: string): typeof fetch {
  return (input, init) => {
    const original = new Request(input, init)
    const rewritten = new URL(original.url)
    const loopback = new URL(loopbackOrigin)
    rewritten.protocol = loopback.protocol
    rewritten.hostname = loopback.hostname
    rewritten.port = loopback.port
    return fetch(new Request(rewritten, original))
  }
}

describe('DokployHttpAdapter', () => {
  it('uses the exact bounded Dokploy HTTP contracts', async () => {
    const captured: CapturedRequest[] = []
    const server = createServer((request, response) => {
      void (async () => {
        const bodyText = await readBody(request)
        const path = request.url ?? ''
        captured.push({
          method: request.method ?? '',
          path,
          ...(typeof request.headers['x-api-key'] === 'string'
            ? { apiKey: request.headers['x-api-key'] }
            : {}),
          ...(bodyText === '' ? {} : { body: JSON.parse(bodyText) as unknown }),
        })
        response.setHeader('content-type', 'application/json')
        if (path.startsWith('/api/deployment.all')) {
          response.end(
            JSON.stringify([
              {
                deploymentId: 'deployment-1',
                status: 'running',
                title: 'stage-revision',
              },
            ]),
          )
          return
        }
        response.end('{}')
      })().catch(() => {
        response.statusCode = 500
        response.end('{}')
      })
    })
    const port = await listen(server)
    const adapter = new DokployHttpAdapter({
      baseUrl: 'https://dokploy.example.com',
      apiKey: 'dokploy-secret',
      fetchImplementation: createFetchBridge(`http://127.0.0.1:${port}`),
    })

    try {
      await adapter.saveEnvironment(
        'app-1',
        `NODE_ENV=production\nSERVICE_REVISION=${'1'.repeat(40)}`,
      )
      await adapter.saveDockerProvider({
        applicationId: 'app-1',
        imageRef:
          'ghcr.io/denischernykh/nest-js-starter@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        registryUrl: 'https://ghcr.io',
        username: 'operator',
        password: 'registry-secret',
      })
      await adapter.deploy({
        applicationId: 'app-1',
        title: 'stage-revision',
        description:
          'Deploy ghcr.io/denischernykh/nest-js-starter@sha256:aaaaaaaa',
      })
      await expect(adapter.listDeployments('app-1')).resolves.toEqual([
        {
          deploymentId: 'deployment-1',
          status: 'running',
          title: 'stage-revision',
        },
      ])
    } finally {
      await close(server)
    }

    expect(captured).toEqual([
      {
        method: 'POST',
        path: '/api/application.saveEnvironment',
        apiKey: 'dokploy-secret',
        body: {
          applicationId: 'app-1',
          env: `NODE_ENV=production\nSERVICE_REVISION=${'1'.repeat(40)}`,
          buildArgs: null,
          buildSecrets: null,
          createEnvFile: false,
        },
      },
      {
        method: 'POST',
        path: '/api/application.saveDockerProvider',
        apiKey: 'dokploy-secret',
        body: {
          applicationId: 'app-1',
          dockerImage:
            'ghcr.io/denischernykh/nest-js-starter@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          registryUrl: 'https://ghcr.io',
          username: 'operator',
          password: 'registry-secret',
        },
      },
      {
        method: 'POST',
        path: '/api/application.deploy',
        apiKey: 'dokploy-secret',
        body: {
          applicationId: 'app-1',
          title: 'stage-revision',
          description:
            'Deploy ghcr.io/denischernykh/nest-js-starter@sha256:aaaaaaaa',
        },
      },
      {
        method: 'GET',
        path: '/api/deployment.all?applicationId=app-1',
        apiKey: 'dokploy-secret',
      },
    ])
  })

  it('refuses redirects for every secret-bearing Dokploy request', async () => {
    const redirects: unknown[] = []
    const adapter = new DokployHttpAdapter({
      baseUrl: 'https://dokploy.example.com',
      apiKey: 'dokploy-secret',
      fetchImplementation: (_input, init) => {
        redirects.push(init?.redirect)
        return Promise.resolve(Response.json({}))
      },
    })

    await adapter.saveDockerProvider({
      applicationId: 'app-1',
      imageRef:
        'ghcr.io/denischernykh/nest-js-starter@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      registryUrl: 'https://ghcr.io',
      username: 'operator',
      password: 'registry-secret',
    })

    expect(redirects).toEqual(['error'])
  })

  it.each([
    {
      name: '401',
      response: new Response('sentinel-private-body', { status: 401 }),
      operation: 'save-environment',
    },
    {
      name: '500',
      response: new Response('sentinel-private-body', { status: 500 }),
      operation: 'save-environment',
    },
    {
      name: 'invalid JSON',
      response: new Response('sentinel-private-body', { status: 200 }),
      operation: 'save-environment',
    },
    {
      name: 'non-empty mutation response',
      response: Response.json({ ok: true }),
      operation: 'save-environment',
    },
  ])(
    'rejects $name without exposing response or API key',
    async ({ response, operation }) => {
      const secret = 'dokploy-api-secret'
      const adapter = new DokployHttpAdapter({
        baseUrl: 'https://dokploy.example.com',
        apiKey: secret,
        fetchImplementation: () => Promise.resolve(response.clone()),
      })

      let failure: unknown
      try {
        await adapter.saveEnvironment('app-1', 'NODE_ENV=production')
      } catch (error) {
        failure = error
      }

      expect(failure).toEqual(
        expect.objectContaining({
          name: 'DokployContractError',
          operation,
        }),
      )
      expect(JSON.stringify(failure)).not.toContain(secret)
      expect(JSON.stringify(failure)).not.toContain('sentinel-private-body')
    },
  )

  it.each([
    {
      name: 'an object instead of an array',
      body: {},
    },
    {
      name: 'a record missing deploymentId',
      body: [{ status: 'running' }],
    },
    {
      name: 'a record missing status',
      body: [{ deploymentId: 'deployment-1' }],
    },
    {
      name: 'a record with a non-string title',
      body: [
        {
          deploymentId: 'deployment-1',
          status: 'running',
          title: 123,
        },
      ],
    },
  ])('rejects $name in a deployment list', async ({ body }) => {
    const adapter = new DokployHttpAdapter({
      baseUrl: 'https://dokploy.example.com',
      apiKey: 'dokploy-secret',
      fetchImplementation: () => Promise.resolve(Response.json(body)),
    })

    await expect(adapter.listDeployments('app-1')).rejects.toBeInstanceOf(
      DokployContractError,
    )
  })

  it('maps a timeout to a redacted transport category', async () => {
    const adapter = new DokployHttpAdapter({
      baseUrl: 'https://dokploy.example.com',
      apiKey: 'dokploy-secret',
      fetchImplementation: () =>
        Promise.reject(
          new DOMException('sentinel-private-error', 'TimeoutError'),
        ),
    })

    let failure: unknown
    try {
      await adapter.listDeployments('app-1')
    } catch (error) {
      failure = error
    }

    expect(failure).toEqual(
      expect.objectContaining({
        name: 'DokployContractError',
        operation: 'list-deployments',
        category: 'timeout',
      }),
    )
    expect(JSON.stringify(failure)).not.toContain('sentinel-private-error')
  })
})
