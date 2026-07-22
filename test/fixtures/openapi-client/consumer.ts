import {
  authLogin,
  authRevokeSession,
  healthLive,
  type AuthLoginResponses,
} from './index.js'

const login = authLogin({
  body: {
    email: 'admin@example.com',
    password: 'correct horse battery staple',
  },
})
const liveness = healthLive()
const revoked = authRevokeSession({
  path: { sessionId: '01J00000000000000000000000' },
})

type LoginSuccess = AuthLoginResponses[200]

function readCsrfToken(response: LoginSuccess): string {
  return response.csrfToken
}

void login
void liveness
void revoked
void readCsrfToken
