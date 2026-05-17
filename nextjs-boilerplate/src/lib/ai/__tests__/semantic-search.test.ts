import { describe, expect, it } from 'vitest';
import { parseIntent } from '../semantic-search';

describe('parseIntent', () => {
  it('detekuje genre + city + date_range', () => {
    const i = parseIntent('jazz koncert v Praze tento víkend');
    expect(i.genreTag).toBe('jazz');
    expect(i.city).toBe('Prague');
    expect(i.dateRange).toBe('this_weekend');
    expect(i.category).toBe('concert');
  });

  it('detekuje audience family', () => {
    const i = parseIntent('rodinný program s dětmi');
    expect(i.audienceTag).toBe('family');
  });

  it('detekuje max price', () => {
    const i = parseIntent('koncerty do 500 Kč');
    expect(i.maxPriceMinor).toBe(50000);
  });

  it('extrahuje keywords bez stopwords', () => {
    const i = parseIntent('hudba a tanec pro mladé lidi');
    expect(i.keywords).toEqual(expect.arrayContaining(['hudba', 'tanec']));
    expect(i.keywords).not.toContain('pro');
    expect(i.keywords).not.toContain('the');
  });

  it('podporuje EN vstup', () => {
    const i = parseIntent('rock concert in Brno tomorrow');
    expect(i.genreTag).toBe('rock');
    expect(i.city).toBe('Brno');
    expect(i.dateRange).toBe('tomorrow');
  });

  it('typo tolerance: keywords obsahují i překlepy (zpracovává SQL trigram match)', () => {
    // parseIntent samotný nedělá fuzzy match — to dělá pg_trgm na DB level.
    // Tento test jen ověřuje, že překlepy nejsou stoplisted a propustí se dál.
    const i = parseIntent('koncrt v Praze');
    expect(i.keywords).toContain('koncrt');
    expect(i.city).toBe('Prague');
  });

  it('elektronická hudba intent', () => {
    const i = parseIntent('techno party v klubu');
    expect(i.genreTag).toBe('electronic');
    expect(i.category).toBe('club_party');
  });
});
