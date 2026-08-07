# Problem types

The starter reserves `https://nest-js-starter.invalid/problems` as its stable
RFC 9457 namespace. A product adopting the starter changes this committed
identity before publishing its own API; runtime hosts and environments do not
change these identifiers.

| Type                                                                      | Code                             | Status | Title                                   | Detail                                                             | Extension |
| ------------------------------------------------------------------------- | -------------------------------- | -----: | --------------------------------------- | ------------------------------------------------------------------ | --------- |
| https://nest-js-starter.invalid/problems/malformed-request                | MALFORMED_REQUEST                |    400 | Malformed request                       | The request could not be parsed.                                   | —         |
| https://nest-js-starter.invalid/problems/auth-token-invalid-or-expired    | AUTH_TOKEN_INVALID_OR_EXPIRED    |    400 | Authentication token invalid or expired | The authentication token is invalid or expired.                    | —         |
| https://nest-js-starter.invalid/problems/authentication-required          | AUTHENTICATION_REQUIRED          |    401 | Authentication required                 | Valid authentication is required for this request.                 | —         |
| https://nest-js-starter.invalid/problems/authorization-denied             | AUTHORIZATION_DENIED             |    403 | Authorization denied                    | The authenticated principal cannot perform this request.           | —         |
| https://nest-js-starter.invalid/problems/email-verification-required      | EMAIL_VERIFICATION_REQUIRED      |    403 | Email verification required             | Email verification is required before authentication can continue. | —         |
| https://nest-js-starter.invalid/problems/approval-self-decision-forbidden | APPROVAL_SELF_DECISION_FORBIDDEN |    403 | Approval self-decision forbidden        | The author cannot decide their own approval request.               | —         |
| https://nest-js-starter.invalid/problems/not-found                        | NOT_FOUND                        |    404 | Resource not found                      | The requested resource does not exist.                             | —         |
| https://nest-js-starter.invalid/problems/approval-request-not-found       | APPROVAL_REQUEST_NOT_FOUND       |    404 | Approval request not found              | The approval request does not exist.                               | —         |
| https://nest-js-starter.invalid/problems/conflict                         | CONFLICT                         |    409 | Request conflict                        | The request conflicts with the current resource state.             | —         |
| https://nest-js-starter.invalid/problems/approval-request-already-decided | APPROVAL_REQUEST_ALREADY_DECIDED |    409 | Approval request already decided        | A decision has already been recorded for this request.             | —         |
| https://nest-js-starter.invalid/problems/payload-too-large                | PAYLOAD_TOO_LARGE                |    413 | Payload too large                       | The request payload exceeds the configured limit.                  | —         |
| https://nest-js-starter.invalid/problems/unsupported-media-type           | UNSUPPORTED_MEDIA_TYPE           |    415 | Unsupported media type                  | The request content type is not supported.                         | —         |
| https://nest-js-starter.invalid/problems/validation-failed                | VALIDATION_FAILED                |    422 | Validation failed                       | One or more request fields are invalid.                            | `errors`  |
| https://nest-js-starter.invalid/problems/rate-limit-exceeded              | RATE_LIMIT_EXCEEDED              |    429 | Rate limit exceeded                     | Too many requests were submitted in the allowed interval.          | —         |
| https://nest-js-starter.invalid/problems/internal-error                   | INTERNAL_ERROR                   |    500 | Internal server error                   | The server could not complete the request.                         | —         |
| https://nest-js-starter.invalid/problems/dependency-unavailable           | DEPENDENCY_UNAVAILABLE           |    503 | Dependency unavailable                  | A required service is temporarily unavailable.                     | —         |

Every response also contains `instance`, `requestId`, and the stable fields
`type`, `title`, `status`, `detail`, and `code`. Only `VALIDATION_FAILED` may add
`errors`; each item contains an RFC 6901 `pointer`, finite client `code`, and
constant `detail`. Rejected values and validator messages are never returned.

The response-conformance gate keeps this table, the composed
`HttpProblemRegistry` definitions exposed by `API_PROBLEM_CATALOG`, and the
exact `ProblemResponseDto.code` OpenAPI enum in lockstep. A problem code absent
from any one of these sources fails the full verification suite.

`openapi:conformance` also exercises representative real responses for
400/401/403/404/413/415/422/429/500/503 and requires the exact
`application/problem+json` media type before validating each body against the
committed component schema. Contract ownership and update workflow are defined
in `docs/architecture/openapi-contracts.md`.
