import { TextDecoder } from 'node:util'

/** Minimal stdin contract supporting both pipes and hidden terminal mode. */
export interface SecretInput extends NodeJS.ReadableStream {
  readonly isTTY?: boolean
  setRawMode?: (mode: boolean) => unknown
}

/** Minimal prompt output that never receives secret bytes. */
export type SecretOutput = NodeJS.WritableStream

const maximumSecretBytes = 1_024
const decoder = new TextDecoder('utf-8', { fatal: true })

function validateSecret(buffer: Buffer): Buffer {
  if (
    buffer.length === 0 ||
    buffer.length > maximumSecretBytes ||
    buffer.includes(0) ||
    decoder.decode(buffer).includes('\n') ||
    decoder.decode(buffer).includes('\r')
  ) {
    throw new Error('Secret input rejected')
  }
  return buffer
}

async function readPipedSecret(input: SecretInput): Promise<Buffer> {
  const chunks: Buffer[] = []
  let byteLength = 0
  try {
    for await (const chunk of input) {
      const bytes = Buffer.isBuffer(chunk)
        ? Buffer.from(chunk)
        : Buffer.from(String(chunk))
      byteLength += bytes.length
      if (byteLength > maximumSecretBytes + 2) {
        input.pause()
        throw new Error('Secret input rejected')
      }
      chunks.push(bytes)
    }
    const collected = Buffer.concat(chunks)
    let payloadLength = collected.length
    if (
      payloadLength >= 2 &&
      collected[payloadLength - 2] === 13 &&
      collected[payloadLength - 1] === 10
    ) {
      payloadLength -= 2
    } else if (
      payloadLength >= 1 &&
      (collected[payloadLength - 1] === 10 ||
        collected[payloadLength - 1] === 13)
    ) {
      payloadLength -= 1
    }
    return validateSecret(Buffer.from(collected.subarray(0, payloadLength)))
  } catch {
    throw new Error('Secret input rejected')
  } finally {
    for (const chunk of chunks) chunk.fill(0)
  }
}

function removeLastCharacter(value: Buffer): Buffer {
  try {
    const characters = [...decoder.decode(value)]
    characters.pop()
    return Buffer.from(characters.join(''))
  } catch {
    return Buffer.alloc(0)
  }
}

function readTtySecret(
  input: SecretInput,
  output: SecretOutput,
): Promise<Buffer> {
  output.write('Password: ')
  input.setRawMode?.(true)
  input.resume()
  return new Promise((resolve, reject) => {
    let secret: Buffer = Buffer.alloc(0)
    let settled = false
    const cleanup = (): void => {
      input.off('data', onData)
      input.off('end', onEnd)
      input.off('error', onError)
      input.setRawMode?.(false)
      input.pause()
      output.write('\n')
    }
    const finish = (result?: Buffer): void => {
      if (settled) return
      settled = true
      cleanup()
      if (result === undefined) {
        secret.fill(0)
        reject(new Error('Secret input rejected'))
        return
      }
      resolve(result)
    }
    const onData = (chunk: string | Buffer): void => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      for (const byte of bytes) {
        if (byte === 3) return finish()
        if (byte === 13 || byte === 10) {
          try {
            return finish(validateSecret(secret))
          } catch {
            return finish()
          }
        }
        if (byte === 8 || byte === 127) {
          const previous = secret
          secret = removeLastCharacter(secret)
          previous.fill(0)
          continue
        }
        if (secret.length >= maximumSecretBytes) return finish()
        const previous = secret
        secret = Buffer.concat([secret, Buffer.of(byte)])
        previous.fill(0)
      }
    }
    const onEnd = (): void => finish()
    const onError = (): void => finish()
    input.on('data', onData)
    input.once('end', onEnd)
    input.once('error', onError)
  })
}

/**
 * Reads one non-empty UTF-8 secret of at most 1024 bytes.
 *
 * @remarks TTY bytes are hidden with raw mode; piped input may end in one
 * LF or CRLF. The returned mutable buffer is owned by the caller and must be
 * overwritten after use.
 */
export function readSecret(
  input: SecretInput,
  output: SecretOutput,
): Promise<Buffer> {
  return input.isTTY === true
    ? readTtySecret(input, output)
    : readPipedSecret(input)
}
