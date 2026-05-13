import { describe, it, expect } from 'vitest';
import { FeeError, type FeeErrorCode } from '../lib/fee-errors';

describe('FeeError', () => {
  it('vytvoří FeeError s kódem FEE_SCHEDULE_NOT_FOUND a statusCode 404', () => {
    const err = new FeeError('FEE_SCHEDULE_NOT_FOUND', 'Schedule nenalezen.');
    expect(err.code).toBe('FEE_SCHEDULE_NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Schedule nenalezen.');
  });

  it('vytvoří FeeError s kódem NO_ACTIVE_SCHEDULE a statusCode 422', () => {
    const err = new FeeError('NO_ACTIVE_SCHEDULE', 'Nemá aktivní schedule.');
    expect(err.code).toBe('NO_ACTIVE_SCHEDULE');
    expect(err.statusCode).toBe(422);
  });

  it('vytvoří FeeError s kódem INVALID_PRICE a statusCode 422', () => {
    const err = new FeeError('INVALID_PRICE', 'Cena musí být >= 0.');
    expect(err.code).toBe('INVALID_PRICE');
    expect(err.statusCode).toBe(422);
  });

  it('FeeError je instanceof Error i instanceof FeeError', () => {
    const err = new FeeError('UNAUTHORIZED', 'Nepřihlášen.');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(FeeError);
  });

  it('toHttpError() vrátí správnou strukturu { error: { code, message } }', () => {
    const err = new FeeError('NO_ACTIVE_SCHEDULE', 'Žádný aktivní schedule.');
    const result = err.toHttpError();
    expect(result).toEqual({
      error: {
        code: 'NO_ACTIVE_SCHEDULE',
        message: 'Žádný aktivní schedule.',
      },
    });
  });
});
