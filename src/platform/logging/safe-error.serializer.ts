const maximumLogTextLength = 512
const maximumStackFrames = 8
const safeErrorType = /^[A-Za-z][A-Za-z0-9]{0,127}$/u
const labelledSecret =
  /\b(authorization|password|token|secret|api[-_]?key|cookie)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu
const bearerCredential = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu
const sensitiveUrl = /\b(?:https?|postgres(?:ql)?|redis(?:s)?):\/\/[^\s]+/giu

/** Safe error representation allowed to enter structured logs. */
export interface SafeSerializedError {
  readonly type: string
  readonly stack?: readonly string[]
}

/**
 * Redacts common credential forms and bounds an arbitrary log string.
 *
 * @param value - Untrusted text from a framework or dependency.
 * @returns A bounded string without labelled secrets, bearer tokens or URLs.
 */
export function sanitizeLogText(value: string): string {
  return value
    .replace(labelledSecret, '$1=[redacted]')
    .replace(bearerCredential, 'Bearer [redacted]')
    .replace(sensitiveUrl, '[redacted-url]')
    .slice(0, maximumLogTextLength)
}

/**
 * Serializes an unknown thrown value without retaining message or cause data.
 *
 * @param error - Unknown failure value owned by central error handling.
 * @returns Stable type and sanitized stack frames for real Error instances.
 */
export function serializeSafeError(error: unknown): SafeSerializedError {
  if (!(error instanceof Error)) {
    return { type: 'NonError' }
  }

  const constructorName = error.constructor.name
  const type = safeErrorType.test(constructorName) ? constructorName : 'Error'
  const stack = error.stack
    ?.split('\n')
    .slice(1)
    .map((frame) => frame.trim())
    .filter((frame) => frame.startsWith('at '))
    .slice(0, maximumStackFrames)
    .map(sanitizeLogText)

  return stack === undefined || stack.length === 0
    ? { type }
    : { type, stack: Object.freeze(stack) }
}
