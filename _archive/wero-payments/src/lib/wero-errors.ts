// =============================================================================
// Wero-specific error types
// =============================================================================

export class WeroError extends Error {
  constructor(
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'WeroError';
  }

  static isWeroError(err: unknown): err is WeroError {
    return err instanceof WeroError;
  }
}
