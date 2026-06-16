import type { PR, SetLog, WorkoutLog } from './types';
import { epley1RM } from './util';

/**
 * Detect PRs in a finished workout against prior history (Part D): max
 * weight, reps-at-weight, estimated 1RM (Epley), and single-session volume,
 * per exercise. Warmups never count.
 *
 * A first-ever performance establishes baselines silently — a PR fires only
 * when an existing record is beaten (previous is always present), so the
 * first workout doesn't stamp four PRs per exercise.
 */
export function detectPRs(workout: WorkoutLog, history: SetLog[]): PR[] {
  const prs: PR[] = [];
  const work = workout.sets.filter((s) => !s.isWarmup && s.weight > 0);
  const prior = history.filter(
    (s) => !s.isWarmup && s.weight > 0 && s.sessionDate < workout.date,
  );
  const exercises = [...new Set(work.map((s) => s.exerciseId))];

  for (const exerciseId of exercises) {
    const now = work.filter((s) => s.exerciseId === exerciseId);
    const past = prior.filter((s) => s.exerciseId === exerciseId);
    if (past.length === 0) continue;

    // weight: heaviest successful set
    const bestNow = now.reduce((a, b) => (b.weight > a.weight ? b : a));
    const prevWeight = Math.max(...past.map((s) => s.weight));
    if (bestNow.weight > prevWeight) {
      prs.push({ type: 'weight', exerciseId, value: bestNow.weight, previous: prevWeight, setIndex: bestNow.setIndex });
    }

    // reps_at_weight: more reps at the same weight than ever before
    for (const s of now) {
      const prevAtWeight = past.filter((p) => p.weight === s.weight);
      if (prevAtWeight.length === 0) continue;
      const prevBest = Math.max(...prevAtWeight.map((p) => p.reps));
      if (s.reps > prevBest) {
        prs.push({ type: 'reps_at_weight', exerciseId, value: s.reps, previous: prevBest, setIndex: s.setIndex });
        break; // one reps-at-weight stamp per exercise per workout
      }
    }

    // e1rm (Epley)
    const e1Now = Math.max(...now.map((s) => epley1RM(s.weight, s.reps)));
    const e1Prev = Math.max(...past.map((s) => epley1RM(s.weight, s.reps)));
    if (e1Now > e1Prev) {
      prs.push({ type: 'e1rm', exerciseId, value: round1(e1Now), previous: round1(e1Prev) });
    }

    // session_volume: Σ weight × reps in one session
    const volNow = now.reduce((t, s) => t + s.weight * s.reps, 0);
    const volBySession = new Map<string, number>();
    for (const s of past) {
      volBySession.set(s.sessionDate, (volBySession.get(s.sessionDate) ?? 0) + s.weight * s.reps);
    }
    const volPrev = Math.max(...volBySession.values());
    if (volNow > volPrev) {
      prs.push({ type: 'session_volume', exerciseId, value: volNow, previous: volPrev });
    }
  }
  return prs;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
