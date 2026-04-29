import { describe, it, expect } from 'vitest';
import { VenueError } from '../lib/venue-errors.js';
import type { VenueErrorCode } from '../lib/venue-errors.js';

describe('VenueError', () => {
  it('is an instance of VenueError and Error', () => {
    const err = new VenueError('VENUE_NOT_FOUND', 'not found');
    expect(err).toBeInstanceOf(VenueError);
    expect(err).toBeInstanceOf(Error);
  });

  it('VENUE_NOT_FOUND has statusCode 404', () => {
    const err = new VenueError('VENUE_NOT_FOUND');
    expect(err.statusCode).toBe(404);
  });

  it('VENUE_SLUG_TAKEN has statusCode 409', () => {
    const err = new VenueError('VENUE_SLUG_TAKEN');
    expect(err.statusCode).toBe(409);
  });

  it('VENUE_ACCESS_DENIED has statusCode 404 (anti-enumeration)', () => {
    const err = new VenueError('VENUE_ACCESS_DENIED');
    expect(err.statusCode).toBe(404);
  });

  it('VENUE_NOT_EDITABLE has statusCode 403', () => {
    const err = new VenueError('VENUE_NOT_EDITABLE');
    expect(err.statusCode).toBe(403);
  });

  it('VENUE_HAS_EVENTS has statusCode 422', () => {
    const err = new VenueError('VENUE_HAS_EVENTS');
    expect(err.statusCode).toBe(422);
  });

  it('INVALID_CAPACITY has statusCode 422', () => {
    const err = new VenueError('INVALID_CAPACITY');
    expect(err.statusCode).toBe(422);
  });

  it('UNAUTHORIZED has statusCode 404 (anti-enumeration)', () => {
    const err = new VenueError('UNAUTHORIZED');
    expect(err.statusCode).toBe(404);
  });

  it('toHttpError() returns correct structure with code and message', () => {
    const err = new VenueError('VENUE_NOT_FOUND', 'Venue not found');
    const result = err.toHttpError();
    expect(result).toEqual({
      error: {
        code: 'VENUE_NOT_FOUND',
        message: 'Venue not found',
      },
    });
  });

  it('toHttpError() includes details when provided', () => {
    const err = new VenueError('VENUE_HAS_EVENTS', 'Has events', { affectedEventCount: 3 });
    const result = err.toHttpError();
    expect(result.error.details).toEqual({ affectedEventCount: 3 });
  });

  it('message defaults to code when not provided', () => {
    const err = new VenueError('VENUE_NOT_FOUND');
    expect(err.message).toBe('VENUE_NOT_FOUND');
  });

  it('code property is set correctly', () => {
    const codes: VenueErrorCode[] = [
      'VENUE_NOT_FOUND', 'VENUE_SLUG_TAKEN', 'VENUE_ACCESS_DENIED',
      'VENUE_NOT_EDITABLE', 'VENUE_HAS_EVENTS', 'INVALID_CAPACITY', 'UNAUTHORIZED',
    ];
    for (const code of codes) {
      const err = new VenueError(code);
      expect(err.code).toBe(code);
    }
  });

  it('name is VenueError', () => {
    const err = new VenueError('VENUE_NOT_FOUND');
    expect(err.name).toBe('VenueError');
  });
});
