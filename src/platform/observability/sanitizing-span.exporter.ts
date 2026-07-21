import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'

type ExportCallback = Parameters<SpanExporter['export']>[1]

const allowedAttributes = new Set([
  'http.request.method',
  'http.response.status_code',
  'http.route',
  'network.protocol.version',
  'url.scheme',
  'db.system',
  'db.system.name',
  'db.operation',
  'db.operation.name',
  'db.namespace',
])

/** Export boundary that removes sensitive and unbounded span payloads. */
export class SanitizingSpanExporter implements SpanExporter {
  public constructor(private readonly delegate: SpanExporter) {}

  /** Forwards shallow immutable span copies with allowlisted attributes only. */
  public export(spans: ReadableSpan[], resultCallback: ExportCallback): void {
    this.delegate.export(spans.map(sanitizeSpan), resultCallback)
  }

  /** Delegates exporter shutdown. */
  public shutdown(): Promise<void> {
    return this.delegate.shutdown()
  }

  /** Delegates an optional force flush without inventing success. */
  public forceFlush?(): Promise<void> {
    return this.delegate.forceFlush?.() ?? Promise.resolve()
  }
}

function sanitizeSpan(span: ReadableSpan): ReadableSpan {
  const clone = Object.create(span) as ReadableSpan
  const attributes = Object.freeze(
    Object.fromEntries(
      Object.entries(span.attributes).filter(([key]) =>
        allowedAttributes.has(key),
      ),
    ),
  )
  Object.defineProperties(clone, {
    attributes: { value: attributes, enumerable: true },
    events: { value: Object.freeze([]), enumerable: true },
    links: { value: Object.freeze([]), enumerable: true },
    status: {
      value: Object.freeze({ code: span.status.code }),
      enumerable: true,
    },
  })
  return Object.freeze(clone)
}
