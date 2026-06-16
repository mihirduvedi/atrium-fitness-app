import type { DeloadDecision, Readiness, StallReport } from './types';

/**
 * Program-level deload (engine_policies.deload):
 * - triggered when 2+ lifts stall in the same week, or readiness is red on
 *   3+ days of the recent log;
 * - scheduled (mandatory) in week 7 of any block if none was triggered
 *   earlier;
 * - prescription: volume −40% (sets), intensity −10% (load), no top sets,
 *   one week.
 *
 * `readinessLog` is the most recent daily readiness entries (last 7 days).
 */
export function shouldDeload(
  week: number,
  stalls: StallReport,
  readinessLog: Readiness[],
  options: { deloadAlreadyThisBlock?: boolean } = {},
): DeloadDecision {
  const prescription = { volumePct: -40, intensityPct: -10, dropTopSets: true, weeks: 1 } as const;

  if (stalls.stalled.length >= 2) {
    return { deload: true, reason: 'two_plus_stalls_same_week', prescription };
  }
  const redDays = readinessLog.filter((r) => r === 'red').length;
  if (redDays >= 3) {
    return { deload: true, reason: 'readiness_red_3plus', prescription };
  }
  if (week === 7 && !options.deloadAlreadyThisBlock) {
    return { deload: true, reason: 'scheduled_week_7', prescription };
  }
  return { deload: false, reason: 'none' };
}
