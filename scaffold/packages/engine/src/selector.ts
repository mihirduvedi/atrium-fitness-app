import { archetypeById } from './data';
import type { ArchetypeId, OnboardingAnswers } from './types';

/**
 * The selector matrix from archetypes.json `selector.rules`, implemented as
 * ordered code (the JSON encodes conditions as strings; this is the
 * executable form — the exhaustiveness test guarantees every onboarding
 * combination lands on a real archetype).
 *
 * Fallback policy (verbatim from the data): if requested days are unavailable
 * for a combination, round DOWN to the nearest archetype — adherence beats
 * volume — and never round a 'new' user up past 4 days.
 */
export function selectArchetype(answers: OnboardingAnswers): ArchetypeId {
  const { goal, experience: exp, equipment } = answers;
  // clamp out-of-range day requests into the catalog's supported span
  const days = Math.min(6, Math.max(2, answers.days_per_week));

  const pick = (id: ArchetypeId): ArchetypeId => {
    if (!archetypeById.has(id)) throw new Error(`selector resolved to unknown archetype: ${id}`);
    return id;
  };

  // 1. returning always on-ramps first; graduates to the matched archetype at week 5
  if (exp === 'returning') return pick('return3');

  // 2. bodyweight
  if (equipment === 'bodyweight') {
    if (days <= 3) return pick('bw_fb3');
    // bw4 is intermediate; a 'new' user rounds down to the 3-day foundation
    return exp === 'new' ? pick('bw_fb3') : pick('bw4');
  }

  // 3. dumbbell
  if (equipment === 'dumbbell') {
    if (goal === 'fat_loss') return pick('db_cut3');
    if (days <= 3) return pick('db_fb3');
    return exp === 'new' ? pick('db_fb3') : pick('db_ul4');
  }

  // 4. home barbell
  if (equipment === 'home_barbell') {
    if (days <= 3) {
      if (exp === 'new') return pick('bb_fb3');
      if (goal === 'strength' && exp === 'advanced') return pick('str3_topset');
      return pick('bb_fb3');
    }
    return exp === 'new' ? pick('bb_fb3') : pick('bb_ul4');
  }

  // full_gym from here on
  if (days === 2) return pick('fb2_busy');
  if (exp === 'new') return pick('fb3_novice_linear');
  if (goal === 'fat_loss') return pick('cut3_fullbody');
  if (goal === 'general') return pick('gen3_mixed');

  if (days === 3) {
    if (goal === 'strength') {
      return exp === 'advanced' ? pick('str3_topset') : pick('fb3_hypertrophy');
    }
    // goal === 'muscle': round to the 3-day hypertrophy archetype
    return pick('fb3_hypertrophy');
  }
  if (days === 4) {
    return goal === 'muscle' ? pick('ul4_hypertrophy') : pick('ul4_strength');
  }
  if (days === 5) return pick('ppl_ul5');
  // days === 6
  return exp === 'advanced' ? pick('ppl6') : pick('ppl_ul5');
}
