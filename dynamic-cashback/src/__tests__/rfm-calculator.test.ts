import { describe, it, expect } from 'vitest';
import { scoreRfm, determineCohort } from '../lib/rfm-calculator.js';

describe('rfm-calculator: scoreRfm thresholds', () => {
  it('recency: 3 days → 5', () => {
    expect(
      scoreRfm({
        recencyDays: 3,
        frequency12m: 1,
        monetaryHalire12m: 0,
      }).recency,
    ).toBe(5);
  });
  it('recency: 20 days → 4', () => {
    expect(
      scoreRfm({
        recencyDays: 20,
        frequency12m: 1,
        monetaryHalire12m: 0,
      }).recency,
    ).toBe(4);
  });
  it('recency: 60 days → 3', () => {
    expect(
      scoreRfm({
        recencyDays: 60,
        frequency12m: 1,
        monetaryHalire12m: 0,
      }).recency,
    ).toBe(3);
  });
  it('recency: 150 days → 2', () => {
    expect(
      scoreRfm({
        recencyDays: 150,
        frequency12m: 1,
        monetaryHalire12m: 0,
      }).recency,
    ).toBe(2);
  });
  it('recency: 200 days → 1', () => {
    expect(
      scoreRfm({
        recencyDays: 200,
        frequency12m: 1,
        monetaryHalire12m: 0,
      }).recency,
    ).toBe(1);
  });

  it('frequency thresholds', () => {
    expect(
      scoreRfm({ recencyDays: 10, frequency12m: 12, monetaryHalire12m: 0 })
        .frequency,
    ).toBe(5);
    expect(
      scoreRfm({ recencyDays: 10, frequency12m: 6, monetaryHalire12m: 0 })
        .frequency,
    ).toBe(4);
    expect(
      scoreRfm({ recencyDays: 10, frequency12m: 3, monetaryHalire12m: 0 })
        .frequency,
    ).toBe(3);
    expect(
      scoreRfm({ recencyDays: 10, frequency12m: 2, monetaryHalire12m: 0 })
        .frequency,
    ).toBe(2);
    expect(
      scoreRfm({ recencyDays: 10, frequency12m: 1, monetaryHalire12m: 0 })
        .frequency,
    ).toBe(1);
  });

  it('monetary thresholds', () => {
    expect(
      scoreRfm({
        recencyDays: 10,
        frequency12m: 1,
        monetaryHalire12m: 2_000_000,
      }).monetary,
    ).toBe(5);
    expect(
      scoreRfm({
        recencyDays: 10,
        frequency12m: 1,
        monetaryHalire12m: 600_000,
      }).monetary,
    ).toBe(4);
    expect(
      scoreRfm({
        recencyDays: 10,
        frequency12m: 1,
        monetaryHalire12m: 300_000,
      }).monetary,
    ).toBe(3);
    expect(
      scoreRfm({
        recencyDays: 10,
        frequency12m: 1,
        monetaryHalire12m: 150_000,
      }).monetary,
    ).toBe(2);
    expect(
      scoreRfm({
        recencyDays: 10,
        frequency12m: 1,
        monetaryHalire12m: 50_000,
      }).monetary,
    ).toBe(1);
  });
});

describe('rfm-calculator: determineCohort', () => {
  it('(5,5,5) → champion', () => {
    expect(determineCohort({ recency: 5, frequency: 5, monetary: 5 })).toBe(
      'champion',
    );
  });
  it('(1,1,1) → lost', () => {
    expect(determineCohort({ recency: 1, frequency: 1, monetary: 1 })).toBe(
      'lost',
    );
  });
  it('(5,1,1) → new', () => {
    expect(determineCohort({ recency: 5, frequency: 1, monetary: 1 })).toBe(
      'new',
    );
  });
  it('(2,5,5) → at_risk', () => {
    expect(determineCohort({ recency: 2, frequency: 5, monetary: 5 })).toBe(
      'at_risk',
    );
  });
  it('(5,4,3) → loyal', () => {
    expect(determineCohort({ recency: 5, frequency: 4, monetary: 3 })).toBe(
      'loyal',
    );
  });
  it('(2,3,2) → hibernating', () => {
    expect(determineCohort({ recency: 2, frequency: 3, monetary: 2 })).toBe(
      'hibernating',
    );
  });
  it('(5,3,3) → potential', () => {
    expect(determineCohort({ recency: 5, frequency: 3, monetary: 3 })).toBe(
      'potential',
    );
  });
});
