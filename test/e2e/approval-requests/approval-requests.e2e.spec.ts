import request, { type Response } from 'supertest'

import {
  createAuthTestRuntime,
  type AuthE2eRuntime,
} from '@test/e2e/support/create-auth-test-runtime'
import {
  assertOpenApiResponseConforms,
  assertProblemResponseConforms,
} from '@test/e2e/openapi/openapi-test-harness'

interface AuthSession {
  readonly baseUrl: string
  readonly cookie: string
  readonly csrfToken: string
}

interface ApprovalResponseBody {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly status: 'pending' | 'approved' | 'rejected'
  readonly createdByUserId: string
  readonly decidedByUserId: string | null
  readonly createdAt: string
  readonly decidedAt: string | null
}

describe('approval request real HTTP workflow', () => {
  let runtime: AuthE2eRuntime
  let baseUrl: string
  let author: AuthSession
  let reviewer: AuthSession
  let outsider: AuthSession
  let selfReviewer: AuthSession
  let authorUserId: string
  let reviewerUserId: string

  beforeAll(async () => {
    runtime = await createAuthTestRuntime(1)
    baseUrl = runtime.instances[0]!.baseUrl
    authorUserId = await runtime.createUser(
      'approval-author@example.com',
      undefined,
      [],
    )
    reviewerUserId = await runtime.createUser(
      'approval-reviewer@example.com',
      undefined,
      ['approval.reviewer'],
    )
    await runtime.createUser('approval-outsider@example.com', undefined, [])
    await runtime.createUser('approval-self-reviewer@example.com', undefined, [
      'approval.reviewer',
    ])
    ;[author, reviewer, outsider, selfReviewer] = await Promise.all([
      login(baseUrl, 'approval-author@example.com'),
      login(baseUrl, 'approval-reviewer@example.com'),
      login(baseUrl, 'approval-outsider@example.com'),
      login(baseUrl, 'approval-self-reviewer@example.com'),
    ])
  })

  afterAll(async () => runtime.stop())

  it('enforces authentication, visibility, reviewer RBAC and terminal policy', async () => {
    const unauthenticated = await request(baseUrl)
      .post('/v1/approval-requests')
      .set('Origin', baseUrl)
      .set('Content-Type', 'application/json')
      .send({ title: 'Missing session', description: 'Must be rejected.' })
      .expect(401)
    expectProblem(unauthenticated, 401, 'AUTHENTICATION_REQUIRED')

    const created = await unsafe(author, 'post', '/v1/approval-requests').send({
      title: '  Production access  ',
      description: '  Please approve the deployment.  ',
    })
    expect(created.status).toBe(201)
    await assertOpenApiResponseConforms('approvalRequestsCreate', created)
    const createdBody = created.body as ApprovalResponseBody
    expect(createdBody).toMatchObject({
      title: 'Production access',
      description: 'Please approve the deployment.',
      status: 'pending',
      createdByUserId: authorUserId,
      decidedByUserId: null,
      decidedAt: null,
    })
    expect(typeof createdBody.id).toBe('string')
    expect(typeof createdBody.createdAt).toBe('string')

    const requestId = createdBody.id
    const visible = await request(baseUrl)
      .get(`/v1/approval-requests/${requestId}`)
      .set('Cookie', author.cookie)
      .expect(200)
    await assertOpenApiResponseConforms('approvalRequestsGet', visible)
    expect(visible.body).toEqual(createdBody)

    const hidden = await request(baseUrl)
      .get(`/v1/approval-requests/${requestId}`)
      .set('Cookie', outsider.cookie)
      .expect(404)
    expectProblem(hidden, 404, 'APPROVAL_REQUEST_NOT_FOUND')

    const denied = await unsafe(
      outsider,
      'put',
      `/v1/approval-requests/${requestId}/decision`,
    )
      .send({ decision: 'approved' })
      .expect(403)
    expectProblem(denied, 403, 'AUTHORIZATION_DENIED')

    const own = await unsafe(
      selfReviewer,
      'post',
      '/v1/approval-requests',
    ).send({
      title: 'Own request',
      description: 'A reviewer must not decide this.',
    })
    expect(own.status).toBe(201)
    const ownBody = own.body as ApprovalResponseBody
    const selfDecision = await unsafe(
      selfReviewer,
      'put',
      `/v1/approval-requests/${ownBody.id}/decision`,
    )
      .send({ decision: 'approved' })
      .expect(403)
    expectProblem(selfDecision, 403, 'APPROVAL_SELF_DECISION_FORBIDDEN')

    const decided = await unsafe(
      reviewer,
      'put',
      `/v1/approval-requests/${requestId}/decision`,
    ).send({ decision: 'approved' })
    expect(decided.status).toBe(200)
    await assertOpenApiResponseConforms('approvalRequestsDecide', decided)
    const decidedBody = decided.body as ApprovalResponseBody
    expect(decidedBody).toMatchObject({
      id: createdBody.id,
      title: createdBody.title,
      description: createdBody.description,
      createdByUserId: createdBody.createdByUserId,
      createdAt: createdBody.createdAt,
      status: 'approved',
      decidedByUserId: reviewerUserId,
    })
    expect(typeof decidedBody.decidedAt).toBe('string')

    const repeatedDecision = await unsafe(
      reviewer,
      'put',
      `/v1/approval-requests/${requestId}/decision`,
    )
      .send({ decision: 'rejected' })
      .expect(409)
    expectProblem(repeatedDecision, 409, 'APPROVAL_REQUEST_ALREADY_DECIDED')
    await assertProblemResponseConforms(repeatedDecision)
  })

  it('creates a request at the Unicode code-point limits', async () => {
    const title = '😀'.repeat(120)
    const description = '🚀'.repeat(2_000)

    const created = await unsafe(author, 'post', '/v1/approval-requests')
      .send({ title, description })
      .expect(201)

    await assertOpenApiResponseConforms('approvalRequestsCreate', created)
    expect(created.body).toMatchObject({ title, description })
  })

  it('publishes and returns a value-free validation problem for an invalid request id', async () => {
    const invalid = await request(baseUrl)
      .get('/v1/approval-requests/not-a-uuid')
      .set('Cookie', author.cookie)
      .expect(422)

    expectProblem(invalid, 422, 'VALIDATION_FAILED')
    expect(JSON.stringify(invalid.body)).not.toContain('not-a-uuid')
    await assertProblemResponseConforms(invalid)
    await assertOpenApiResponseConforms('approvalRequestsGet', invalid)
  })
})

async function login(baseUrl: string, email: string): Promise<AuthSession> {
  const response = await request(baseUrl)
    .post('/v1/auth/login')
    .set('Origin', baseUrl)
    .set('Content-Type', 'application/json')
    .send({ email, password: 'valid password' })
    .expect(200)
  const cookie = response.headers['set-cookie']?.[0]?.split(';', 1)[0]
  if (cookie === undefined) throw new Error('Login response omitted cookie')
  const body: unknown = response.body
  if (
    typeof body !== 'object' ||
    body === null ||
    !('csrfToken' in body) ||
    typeof body.csrfToken !== 'string'
  ) {
    throw new Error('Login response omitted CSRF token')
  }
  return {
    baseUrl,
    cookie,
    csrfToken: body.csrfToken,
  }
}

function unsafe(
  session: AuthSession,
  method: 'post' | 'put',
  path: string,
): request.Test {
  return request(session.baseUrl)
    [method](path)
    .set('Cookie', session.cookie)
    .set('Origin', session.baseUrl)
    .set('Content-Type', 'application/json')
    .set('X-CSRF-Token', session.csrfToken)
}

function expectProblem(response: Response, status: number, code: string): void {
  expect(response.headers['content-type']).toMatch(
    /^application\/problem\+json/u,
  )
  const body: unknown = response.body
  expect(body).toMatchObject({ status, code })
  expect(body).toHaveProperty('requestId')
  if (typeof body !== 'object' || body === null || !('requestId' in body)) {
    throw new Error('Problem response omitted requestId')
  }
  expect(typeof body.requestId).toBe('string')
  expect(body).not.toHaveProperty('message')
  expect(body).not.toHaveProperty('stack')
  expect(body).not.toHaveProperty('cause')
  expect(JSON.stringify(body)).not.toContain(
    'Approval request is already decided',
  )
  expect(JSON.stringify(body)).not.toContain(
    'Approval request author cannot decide their own request',
  )
}
