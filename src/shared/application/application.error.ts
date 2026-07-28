/**
 * Framework-free application failure carrying one stable machine code.
 *
 * @remarks
 * The message and optional cause remain internal diagnostic data. Transport
 * status, public detail and problem type belong to an outer composition
 * boundary.
 *
 * @typeParam TCode - Stable code union owned by the producing application.
 */
export abstract class ApplicationError<TCode extends string> extends Error {
  protected constructor(
    public readonly code: TCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}
