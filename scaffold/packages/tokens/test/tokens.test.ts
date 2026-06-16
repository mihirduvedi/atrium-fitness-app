import { describe, expect, it } from 'vitest';
import { colors, day, night, radius, space, type, type TextStyleToken } from '../src';

describe('@atrium/tokens', () => {
  it('day and night expose identical token keys (modes change surfaces, never structure)', () => {
    expect(Object.keys(night).sort()).toEqual(Object.keys(day).sort());
  });

  it('never uses pure black or pure white for text or canvas', () => {
    for (const mode of ['day', 'night'] as const) {
      for (const key of ['bgCanvas', 'textPrimary', 'textMuted', 'textFaint'] as const) {
        expect(colors[mode][key].toUpperCase()).not.toBe('#000000');
        expect(colors[mode][key].toUpperCase()).not.toBe('#FFFFFF');
      }
    }
  });

  it('matches the spec values verbatim (regression anchor for the token table)', () => {
    expect(day.bgCanvas).toBe('#FBFBF9');
    expect(night.bgCanvas).toBe('#1A1918');
    expect(day.textPrimary).toBe('#37352F');
    expect(night.textPrimary).toBe('#EBE8E0');
    expect(day.actionInk).toBe(day.textPrimary); // chrome is ink, intentionally
    expect(night.actionInk).toBe(night.textPrimary);
    expect(night.borderHairline).toBe('rgba(235, 232, 224, 0.08)');
    expect(night.borderStrong).toBe('rgba(235, 232, 224, 0.17)');
    expect(day.dataBlue).toBe('#6E87A8');
    expect(night.dataBlue).toBe('#8FA9CD');
    expect(day.dataCoral).toBe('#C06E54');
    expect(radius).toEqual({ card: 12, control: 8 });
    expect(Object.values(space)).toEqual([4, 8, 12, 16, 20, 24, 32, 40]);
  });

  it('keeps hero numbers thin and data mono (the two never swap jobs)', () => {
    expect(type.heroNumXL.weight).toBe(300);
    expect(type.heroNumL.weight).toBe(300);
    expect(type.dataM.role).toBe('mono');
    expect(type.dataS.role).toBe('mono');
    expect((type.button as TextStyleToken).caps).toBeUndefined();
  });
});
