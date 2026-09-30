import {describe, expect, it} from 'vitest';
import {studioDate, studioDay} from '../src/lib/format.ts';

describe('даты по-русски', () => {
  const tz = 'Europe/Moscow';
  // Четверг, 1 октября 2026, 12:00 по Москве.
  const now = new Date('2026-10-01T09:00:00Z');

  it('короткий день недели из двух букв, месяц словом', () => {
    expect(studioDate('2026-10-02T07:00:00Z', tz)).toBe('пт, 2 октября');
    expect(studioDate('2026-10-07T07:00:00Z', tz)).toBe('ср, 7 октября');
  });

  it('сегодня, завтра, послезавтра, дальше дата', () => {
    expect(studioDay('2026-10-01T15:00:00Z', tz, now)).toBe('сегодня');
    expect(studioDay('2026-10-02T07:00:00Z', tz, now)).toBe('завтра');
    expect(studioDay('2026-10-03T07:00:00Z', tz, now)).toBe('послезавтра');
    expect(studioDay('2026-10-05T07:00:00Z', tz, now)).toBe('пн, 5 октября');
  });

  it('день считается по часовому поясу студии', () => {
    // 22:30 UTC 1 октября — это уже 2 октября в Москве.
    expect(studioDay('2026-10-01T22:30:00Z', tz, now)).toBe('завтра');
  });
});
