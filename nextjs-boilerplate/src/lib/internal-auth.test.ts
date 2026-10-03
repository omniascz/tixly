import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  verifyInternalToken,
  getInternalToken,
  internalAuthHeaders,
  safeTokenEqual,
} from './internal-auth';

const SAVED = {
  api: process.env.INTERNAL_API_TOKEN,
  service: process.env.INTERNAL_SERVICE_TOKEN,
};

beforeEach(() => {
  delete process.env.INTERNAL_API_TOKEN;
  delete process.env.INTERNAL_SERVICE_TOKEN;
});

afterEach(() => {
  if (SAVED.api === undefined) delete process.env.INTERNAL_API_TOKEN;
  else process.env.INTERNAL_API_TOKEN = SAVED.api;
  if (SAVED.service === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
  else process.env.INTERNAL_SERVICE_TOKEN = SAVED.service;
});

describe('getInternalToken', () => {
  it('bere INTERNAL_SERVICE_TOKEN — jméno, které používá nasazení', () => {
    process.env.INTERNAL_SERVICE_TOKEN = 'tajne';
    expect(getInternalToken()).toBe('tajne');
  });

  it('INTERNAL_API_TOKEN má přednost, když jsou obě', () => {
    process.env.INTERNAL_SERVICE_TOKEN = 'stare';
    process.env.INTERNAL_API_TOKEN = 'nove';
    expect(getInternalToken()).toBe('nove');
  });

  it('prázdná hodnota se bere jako nenastavená', () => {
    process.env.INTERNAL_SERVICE_TOKEN = '';
    expect(getInternalToken()).toBeNull();
  });
});

describe('verifyInternalToken', () => {
  it('bez nastaveného hesla odmítne i správně vypadající požadavek', () => {
    const r = verifyInternalToken('cokoli');
    expect(r).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('prázdné heslo v prostředí neotevírá dveře prázdné hlavičce', () => {
    process.env.INTERNAL_SERVICE_TOKEN = '';
    expect(verifyInternalToken('')).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('chybějící hlavička je odmítnuta', () => {
    process.env.INTERNAL_SERVICE_TOKEN = 'tajne';
    expect(verifyInternalToken(null)).toEqual({ ok: false, reason: 'missing' });
  });

  it('špatné heslo je odmítnuto', () => {
    process.env.INTERNAL_SERVICE_TOKEN = 'tajne';
    expect(verifyInternalToken('jine')).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('REGRESE: volající pošle INTERNAL_SERVICE_TOKEN a projde', () => {
    // Přesně tenhle případ vracel 401 a kvůli tomu se nikdy nenačetly podíly umělců.
    process.env.INTERNAL_SERVICE_TOKEN = 'tajne';
    expect(verifyInternalToken('tajne')).toEqual({ ok: true });
  });
});

describe('internalAuthHeaders', () => {
  it('bez hesla neposílá hlavičku vůbec', () => {
    expect(internalAuthHeaders()).toEqual({});
  });

  it('s heslem pošle hlavičku, kterou příjemce očekává', () => {
    process.env.INTERNAL_SERVICE_TOKEN = 'tajne';
    const h = internalAuthHeaders();
    expect(h['x-internal-token']).toBe('tajne');
    expect(verifyInternalToken(h['x-internal-token'])).toEqual({ ok: true });
  });
});

describe('safeTokenEqual', () => {
  it('různá délka neshoduje a nespadne', () => {
    expect(safeTokenEqual('a', 'ab')).toBe(false);
  });
  it('shodné hodnoty se shodují', () => {
    expect(safeTokenEqual('abc', 'abc')).toBe(true);
  });
});
