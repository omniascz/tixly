import { describe, it, expect } from 'vitest';
import { validateIco, validateCzIban, validatePassword } from '../lib/validators';

describe('validateIco', () => {
  it('returns true for exactly 8 digits', () => {
    expect(validateIco('12345678')).toBe(true);
  });

  it('returns true for another valid 8-digit IČO', () => {
    expect(validateIco('00000000')).toBe(true);
  });

  it('returns false for 7 digits', () => {
    expect(validateIco('1234567')).toBe(false);
  });

  it('returns false for 9 digits', () => {
    expect(validateIco('123456789')).toBe(false);
  });

  it('returns false when contains a letter', () => {
    expect(validateIco('1234567a')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(validateIco('')).toBe(false);
  });

  it('returns false for string with spaces', () => {
    expect(validateIco('1234 678')).toBe(false);
  });
});

describe('validateCzIban', () => {
  it('returns true for valid CZ IBAN (24 chars)', () => {
    expect(validateCzIban('CZ6508000000192000145399')).toBe(true);
  });

  it('returns true for another valid CZ IBAN', () => {
    expect(validateCzIban('CZ0000000000000000000000')).toBe(true);
  });

  it('returns false for non-CZ IBAN', () => {
    expect(validateCzIban('DE89370400440532013000')).toBe(false);
  });

  it('returns false for too short CZ IBAN', () => {
    expect(validateCzIban('CZ123')).toBe(false);
  });

  it('returns false for CZ IBAN with letters in digit part', () => {
    expect(validateCzIban('CZ650800000019200014539X')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(validateCzIban('')).toBe(false);
  });

  it('returns false for IBAN with spaces', () => {
    expect(validateCzIban('CZ65 0800 0000 1920 0014 5399')).toBe(false);
  });
});

describe('validatePassword', () => {
  it('returns true for password with 8+ chars and a digit', () => {
    expect(validatePassword('password1')).toBe(true);
  });

  it('returns true for complex password', () => {
    expect(validatePassword('MySecurePass123!')).toBe(true);
  });

  it('returns false for password without a digit', () => {
    expect(validatePassword('password')).toBe(false);
  });

  it('returns false for password shorter than 8 chars', () => {
    expect(validatePassword('pass1')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(validatePassword('')).toBe(false);
  });

  it('returns false for 7 chars with digit', () => {
    expect(validatePassword('passwor1')).toBe(true); // exactly 8 chars — passes
  });

  it('returns false for only digits but less than 8', () => {
    expect(validatePassword('1234567')).toBe(false);
  });
});
