import type { Readiness, SessionPlan } from './types';
import { COMPOUND_PATTERNS, roundToPlate } from './util';

/**
 * Readiness modulation (engine_policies.readiness_modulation). The invariant
 * the property tests enforce: readiness NEVER increases load or volume —
 * upside adjustments are coach suggestions only, and the coach can't write
 * loads (safety_bounds.hard_rule).
 *
 * - green:  session as planned
 * - yellow: remove 1 back-off/accessory set per compound slot; loads unchanged
 * - red:    technique session — 80% of planned loads, volume −30%, no top sets
 */
export function applyReadiness(session: SessionPlan, readiness: Readiness): SessionPlan {
  if (readiness === 'green') return { ...session, readinessApplied: 'green' };

  if (readiness === 'yellow') {
    const prescriptions = session.prescriptions.map((p) => {
      const isCompound = p.sets.some((s) => s.kind === 'top') || COMPOUND_PATTERNS.has(p.nextState.pattern);
      if (!isCompound || p.sets.length <= 1) return p;
      // drop the LAST non-top set; loads unchanged
      const lastWorkIdx = [...p.sets].reverse().find((s) => s.kind !== 'top')?.setIndex;
      if (lastWorkIdx === undefined) return p;
      return { ...p, sets: p.sets.filter((s) => s.setIndex !== lastWorkIdx) };
    });
    return { ...session, prescriptions, readinessApplied: 'yellow' };
  }

  // red
  const prescriptions = session.prescriptions.map((p) => {
    const noTop = p.sets.filter((s) => s.kind !== 'top');
    const kept = noTop.length > 0 ? noTop : p.sets; // a 1×top-only slot keeps one (lightened) set
    const targetCount = Math.max(1, Math.round(kept.length * 0.7));
    const reduced = kept.slice(0, targetCount).map((s) => ({
      ...s,
      kind: 'work' as const,
      weight: s.weight === undefined ? undefined : roundToPlate(s.weight * 0.8),
    }));
    return { ...p, sets: reduced, note: joinNote(p.note, 'readiness red — technique session @ 80%') };
  });
  return { ...session, prescriptions, readinessApplied: 'red' };
}

const joinNote = (a: string | undefined, b: string) => (a ? `${a} · ${b}` : b);
