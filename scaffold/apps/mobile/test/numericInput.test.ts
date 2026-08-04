import { describe, expect, it } from 'vitest';
import { sanitizeDecimalInput, sanitizeWholeNumberInput } from '../src/numericInput';

describe('numeric workout inputs', () => {
  it('keeps only whole-number digits for reps and rest timers', () => {
    expect(sanitizeWholeNumberInput('12reps')).toBe('12');
    expect(sanitizeWholeNumberInput('a 1-2.5')).toBe('125');
  });

  it('allows one decimal point for weight while removing letters and extra punctuation', () => {
    expect(sanitizeDecimalInput('12.5lb')).toBe('12.5');
    expect(sanitizeDecimalInput('1.2.5')).toBe('1.25');
    expect(sanitizeDecimalInput('abc')).toBe('');
  });
});
