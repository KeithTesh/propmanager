// api/src/__tests__/prorationEngine.test.ts
/**
 * Proration engine unit tests
 * These are pure function tests — no DB needed
 */
import { describe, it, expect } from 'vitest';
import { calculateProration, generateFirstBillPreview } from '../lib/prorationEngine';

describe('calculateProration', () => {
  const base = {
    monthlyRent: 30000,
    minProrationThreshold: 500,
  };

  it('returns full month when move-in is on 1st', () => {
    const result = calculateProration({
      ...base,
      moveInDate: '2026-03-01',
      prorationType: 'always',
      prorationCutoff: null,
      prorationMethod: 'actual_days',
    });
    expect(result.isProrated).toBe(false);
    expect(result.billAmount).toBe(30000);
  });

  it('prorates correctly with actual_days for March (31 days)', () => {
    // Move in March 15 → 17 days occupied (15,16,...,31)
    const result = calculateProration({
      ...base,
      moveInDate: '2026-03-15',
      prorationType: 'always',
      prorationCutoff: null,
      prorationMethod: 'actual_days',
    });
    expect(result.isProrated).toBe(true);
    expect(result.proratedDays).toBe(17);
    expect(result.daysInMonth).toBe(31);
    // 30000/31 = 967.74.../day → floor to 967.74 → 967 * 17 = 16439
    expect(result.billAmount).toBe(Math.floor(Math.floor(30000 / 31 * 100) / 100 * 17));
  });

  it('prorates correctly with standard_30', () => {
    const result = calculateProration({
      ...base,
      moveInDate: '2026-03-15',
      prorationType: 'always',
      prorationCutoff: null,
      prorationMethod: 'standard_30',
    });
    expect(result.isProrated).toBe(true);
    expect(result.daysInMonth).toBe(30); // standard always 30
    // 30000/30 = 1000/day, 17 days = 17000
    expect(result.billAmount).toBe(17000);
  });

  it('does NOT prorate when type is never', () => {
    const result = calculateProration({
      ...base,
      moveInDate: '2026-03-20',
      prorationType: 'never',
      prorationCutoff: null,
      prorationMethod: 'actual_days',
    });
    expect(result.isProrated).toBe(false);
    expect(result.billAmount).toBe(30000);
  });

  it('does NOT prorate when move-in is before cutoff (after_cutoff mode)', () => {
    const result = calculateProration({
      ...base,
      moveInDate: '2026-03-10',   // day 10, cutoff is 15
      prorationType: 'after_cutoff',
      prorationCutoff: 15,
      prorationMethod: 'actual_days',
    });
    expect(result.isProrated).toBe(false);
    expect(result.billAmount).toBe(30000);
  });

  it('DOES prorate when move-in is after cutoff', () => {
    const result = calculateProration({
      ...base,
      moveInDate: '2026-03-20',   // day 20, cutoff is 15
      prorationType: 'after_cutoff',
      prorationCutoff: 15,
      prorationMethod: 'actual_days',
    });
    expect(result.isProrated).toBe(true);
    expect(result.proratedDays).toBe(12); // days 20-31
  });

  it('charges full month when prorated amount is below minimum threshold', () => {
    const result = calculateProration({
      monthlyRent: 5000,
      minProrationThreshold: 2000,
      moveInDate: '2026-03-29',  // only 3 days → 5000/31*3 ≈ 483 < 2000
      prorationType: 'always',
      prorationCutoff: null,
      prorationMethod: 'actual_days',
    });
    expect(result.isProrated).toBe(false);
    expect(result.billAmount).toBe(5000); // full month charged
  });

  it('always floors to whole shilling — never fractional', () => {
    const result = calculateProration({
      ...base,
      moveInDate: '2026-02-10',  // Feb has 28 days in 2026
      prorationType: 'always',
      prorationCutoff: null,
      prorationMethod: 'actual_days',
    });
    expect(result.billAmount % 1).toBe(0); // whole number
    expect(result.dailyRate).not.toBeNull();
  });

  it('includes human-readable description', () => {
    const result = calculateProration({
      ...base,
      moveInDate: '2026-03-15',
      prorationType: 'always',
      prorationCutoff: null,
      prorationMethod: 'actual_days',
    });
    expect(result.description).toContain('days');
    expect(result.description).toContain('KES');
    expect(result.description).toContain('/day');
  });
});

describe('generateFirstBillPreview', () => {
  it('returns signing bill + first recurring bill', () => {
    const preview = generateFirstBillPreview({
      monthlyRent: 25000,
      moveInDate: '2026-03-15',
      prorationType: 'always',
      prorationCutoff: null,
      prorationMethod: 'actual_days',
      minProrationThreshold: 500,
      dueDay: 1,
    });
    expect(preview.signingBill).toBeDefined();
    expect(preview.signingBill.dueDate).toBe('2026-03-15');
    expect(preview.firstRecurringBill.forMonth).toBe('2026-04-01');
    expect(preview.firstRecurringBill.amount).toBe(25000);
    expect(preview.firstRecurringBill.dueDate).toBe('2026-04-01');
  });
});