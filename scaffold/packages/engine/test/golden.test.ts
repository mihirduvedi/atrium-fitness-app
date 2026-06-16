import { describe, expect, it } from 'vitest';
import { instantiateProgram, nextPrescription, type SetLog, type SlotState } from '../src';

// Part D test requirement 3: the golden test. Simulate 12 weeks of
// ul4_strength for a synthetic user and snapshot the full prescription
// sequence. This fixture is the regression anchor for ALL future engine
// edits — if a change alters this snapshot, that change altered real
// users' future loads and must be reviewed as such.
//
// Synthetic user (deterministic): completes ceil(0.85 × top-of-range) reps
// on every set, at the prescribed weight. That clears some targets (top
// sets: ceil(5.1) = 6 ≥ 6) and stalls others (back-offs: ceil(6.8) = 7 < 8),
// so the sequence exercises progression, stall, swap and deload paths.

const START_WEIGHTS: Record<string, number> = {
  bb_bench: 135,
  bb_row: 95,
  bb_ohp: 65,
  lat_pulldown: 120,
  db_curl: 25,
  bb_back_squat: 185,
  bb_rdl: 135,
  leg_press: 270,
  calf_raise: 90,
  bb_incline_bench: 115,
  chest_supported_row: 110,
  db_shoulder_press: 35,
  lateral_raise: 15,
  triceps_pushdown: 50,
  cable_curl: 30,
  bb_front_squat: 135,
  hip_thrust: 185,
  leg_curl: 90,
};

const performedReps = (targetTop: number): number => Math.ceil(targetTop * 0.85);

describe('golden: 12 weeks of ul4_strength @ 85% completion', () => {
  it('matches the frozen prescription sequence', () => {
    let n = 0;
    const plan = instantiateProgram('ul4_strength', 'full_gym', 'intermediate', (k) => `${k}${++n}`);

    // seed starting loads
    const states = new Map<string, SlotState>();
    for (const day of plan.days)
      for (const slot of day.slots) {
        const w = START_WEIGHTS[slot.exerciseId];
        states.set(slot.slotId, {
          ...slot.state,
          ...(slot.rule === 'top_set_backoff' ? { topWeight: w } : { workingWeight: w }),
        });
      }

    const history: SetLog[] = [];
    const lines: string[] = [];
    let dayCounter = 0;

    for (let week = 1; week <= 12; week++) {
      for (const day of plan.days) {
        dayCounter++;
        const date = `2026-${String(Math.ceil(dayCounter / 28) + 5).padStart(2, '0')}-${String(((dayCounter - 1) % 28) + 1).padStart(2, '0')}`;
        for (const slot of day.slots) {
          const state = states.get(slot.slotId)!;
          const p = nextPrescription(state, history);
          states.set(slot.slotId, p.nextState);

          const setsDesc = p.sets
            .map((s) => {
              const target = s.targetSeconds !== undefined ? `${s.targetSeconds}s` : `${s.targetReps[0]}-${s.targetReps[1]}`;
              const w = s.weight !== undefined ? `@${s.weight}` : '';
              return `${s.kind === 'top' ? 'T' : s.kind === 'backoff' ? 'B' : 'W'}${target}${w}`;
            })
            .join(' ');
          lines.push(
            `w${String(week).padStart(2, '0')} ${day.name} · ${p.exerciseId} [${p.nextState.rule}] ${setsDesc}${p.note ? ` — ${p.note}` : ''}`,
          );

          // the synthetic user performs the session
          for (const s of p.sets) {
            const top = s.targetSeconds ?? s.targetReps[1];
            history.push({
              exerciseId: p.exerciseId,
              sessionDate: date,
              setIndex: s.setIndex,
              weight: s.weight ?? 0,
              reps: performedReps(top),
              ...(s.targetSeconds !== undefined ? { seconds: performedReps(top) } : null),
            });
          }
        }
      }
    }

    expect(lines.length).toBe(12 * 4 * 5 + 12 * 1); // 4 days × 5 slots + day 3 has 6 slots
    expect(lines.join('\n')).toMatchSnapshot();
  });
});
