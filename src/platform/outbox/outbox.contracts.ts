export const OUTBOX_MAX_PAYLOAD_BYTES = 64 * 1024
export const OUTBOX_MAX_VERSION = 2_147_483_647

type JsonPrimitive = boolean | number | string | null

export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[]

export interface JsonObject {
  readonly [key: string]: JsonValue
}

export interface OutboxMessageDraft {
  readonly destination: string
  readonly type: string
  readonly version: number
  readonly partitionKey?: string
  readonly correlationId?: string
  readonly occurredAt: Date
  readonly payload: JsonObject
}

export interface OutboxMessageEnvelope {
  readonly messageId: string
  readonly destination: string
  readonly type: string
  readonly version: number
  readonly partitionKey?: string
  readonly correlationId?: string
  readonly occurredAt: string
  readonly payload: JsonObject
}

export function createOutboxMessageEnvelope(
  messageId: string,
  message: OutboxMessageDraft,
): Readonly<OutboxMessageEnvelope> {
  return Object.freeze({
    messageId,
    destination: message.destination,
    type: message.type,
    version: message.version,
    ...(message.partitionKey === undefined
      ? {}
      : { partitionKey: message.partitionKey }),
    ...(message.correlationId === undefined
      ? {}
      : { correlationId: message.correlationId }),
    occurredAt: message.occurredAt.toISOString(),
    payload: cloneJsonObject(message.payload),
  })
}

export class OutboxMessageValidationError extends Error {
  public constructor(reason: string) {
    super(`Invalid outbox message: ${reason}`)
    this.name = 'OutboxMessageValidationError'
  }
}

export function validateOutboxMessageDraft(
  value: unknown,
): Readonly<OutboxMessageDraft> {
  if (!isRecord(value)) {
    throw new OutboxMessageValidationError('draft must be an object')
  }

  const destination = validateRequiredString(
    value['destination'],
    'destination',
    100,
  )
  const type = validateRequiredString(value['type'], 'type', 120)
  const version = value['version']
  if (
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    version > OUTBOX_MAX_VERSION
  ) {
    throw new OutboxMessageValidationError(
      `version must be an integer between 1 and ${OUTBOX_MAX_VERSION}`,
    )
  }

  const occurredAt = value['occurredAt']
  if (!(occurredAt instanceof Date) || Number.isNaN(occurredAt.getTime())) {
    throw new OutboxMessageValidationError('occurredAt must be a valid date')
  }

  const payload = validatePayload(value['payload'])
  if (outboxPayloadSizeBytes(payload) > OUTBOX_MAX_PAYLOAD_BYTES) {
    throw new OutboxMessageValidationError('payload exceeds 64 KiB')
  }

  const partitionKey = validateOptionalString(
    value['partitionKey'],
    'partitionKey',
    200,
  )
  const correlationId = validateOptionalString(
    value['correlationId'],
    'correlationId',
    200,
  )

  return Object.freeze({
    destination,
    type,
    version,
    ...(partitionKey === undefined ? {} : { partitionKey }),
    ...(correlationId === undefined ? {} : { correlationId }),
    occurredAt: new Date(occurredAt.getTime()),
    payload,
  })
}

export function outboxPayloadSizeBytes(payload: JsonObject): number {
  return Buffer.byteLength(JSON.stringify(payload), 'utf8')
}

function validateRequiredString(
  value: unknown,
  field: string,
  maximumLength: number,
): string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length === 0
  ) {
    throw new OutboxMessageValidationError(
      `${field} must be a non-empty string`,
    )
  }
  if (value.length > maximumLength) {
    throw new OutboxMessageValidationError(
      `${field} exceeds ${maximumLength} characters`,
    )
  }
  return value
}

function validateOptionalString(
  value: unknown,
  field: string,
  maximumLength: number,
): string | undefined {
  if (value === undefined) return undefined
  return validateRequiredString(value, field, maximumLength)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validatePayload(value: unknown): JsonObject {
  if (!isPlainObject(value)) {
    throw new OutboxMessageValidationError('payload must be a JSON object')
  }
  validateJsonValue(value, new Set<object>())
  return cloneJsonObject(value as JsonObject)
}

function validateJsonValue(value: unknown, ancestry: Set<object>): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return
  }
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (Array.isArray(value)) {
    validateJsonContainer(value, ancestry)
    return
  }
  if (!isPlainObject(value)) {
    throw new OutboxMessageValidationError(
      'payload must contain JSON values only',
    )
  }
  validateJsonContainer(value, ancestry)
}

function validateJsonContainer(
  value: readonly unknown[] | Record<string, unknown>,
  ancestry: Set<object>,
): void {
  if (ancestry.has(value)) {
    throw new OutboxMessageValidationError('payload must not contain cycles')
  }
  ancestry.add(value)
  for (const [key, child] of Object.entries(value)) {
    if (isCredentialKey(key)) {
      throw new OutboxMessageValidationError(
        'payload contains a credential-shaped key',
      )
    }
    validateJsonValue(child, ancestry)
  }
  ancestry.delete(value)
}

const credentialSegments = new Set([
  'authorization',
  'bearer',
  'cookie',
  'credential',
  'password',
  'secret',
  'token',
])

function isCredentialKey(key: string): boolean {
  const segments = key
    .replaceAll(/([a-z\d])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z\d]+/u)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase())
  return (
    segments.some((segment) => credentialSegments.has(segment)) ||
    segments.some(
      (segment, index) =>
        (segment === 'api' || segment === 'private') &&
        segments[index + 1] === 'key',
    )
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function cloneJsonObject(value: JsonObject): JsonObject {
  const cloned = JSON.parse(JSON.stringify(value)) as unknown
  return deepFreeze(cloned as JsonObject)
}

function deepFreeze<T extends JsonValue>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
