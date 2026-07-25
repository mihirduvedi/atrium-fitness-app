import { exerciseCatalog } from './data';
import type { Prescription, PrescribedSet, RepRange, SessionPlan } from './types';
import { COMPOUND_PATTERNS, ISOLATION_PATTERNS, roundToPlate } from './util';

interface WarmupRecipe {
  pct?: number;
  weight?: number;
  reps: number;
}

const FIRST_COMPOUND_WARMUPS: WarmupRecipe[] = [
  { pct: 0.4, reps: 10 },
  { pct: 0.55, reps: 5 },
  { pct: 0.7, reps: 3 },
  { pct: 0.85, reps: 1 },
];

const LATER_COMPOUND_WARMUPS: WarmupRecipe[] = [
  { pct: 0.6, reps: 5 },
  { pct: 0.8, reps: 2 },
];

const ISOLATION_WARMUPS: WarmupRecipe[] = [
  { pct: 0.5, reps: 10 },
];

const UNKNOWN_FIRST_BARBELL_WARMUPS: WarmupRecipe[] = [
  { weight: 45, reps: 10 },
];

const UNKNOWN_LATER_BARBELL_WARMUPS: WarmupRecipe[] = [
  { weight: 45, reps: 5 },
];

function firstWeightedWorkSet(prescription: Prescription) {
  return prescription.sets.find((set) => !set.isWarmup && set.targetSeconds === undefined && set.weight !== undefined);
}

function warmupSets(workingWeight: number | undefined, recipes: WarmupRecipe[]): PrescribedSet[] {
  return recipes.map((recipe, index) => {
    const reps = [recipe.reps, recipe.reps] as RepRange;
    const weight = recipe.weight ?? (workingWeight === undefined || recipe.pct === undefined
      ? undefined
      : roundToPlate(workingWeight * recipe.pct));
    return {
      setIndex: index - recipes.length,
      weight,
      targetReps: reps,
      kind: 'warmup',
      isWarmup: true,
    };
  });
}

export function renderWarmups(session: SessionPlan): SessionPlan {
  let compoundSeen = false;
  const prescriptions = session.prescriptions.map((prescription) => {
    const firstWork = firstWeightedWorkSet(prescription);
    const pattern = prescription.nextState.pattern;
    const isCompound = COMPOUND_PATTERNS.has(pattern);
    const knownWeight = firstWork?.weight && firstWork.weight > 0 ? firstWork.weight : undefined;
    const equipment = exerciseCatalog[prescription.exerciseId]?.equipment;
    const recipes = COMPOUND_PATTERNS.has(pattern)
      ? knownWeight !== undefined
        ? compoundSeen
          ? LATER_COMPOUND_WARMUPS
          : FIRST_COMPOUND_WARMUPS
        : equipment === 'barbell'
          ? compoundSeen
            ? UNKNOWN_LATER_BARBELL_WARMUPS
            : UNKNOWN_FIRST_BARBELL_WARMUPS
          : []
      : ISOLATION_PATTERNS.has(pattern)
        ? knownWeight !== undefined ? ISOLATION_WARMUPS : []
        : [];

    if (isCompound) compoundSeen = true;
    if (recipes.length === 0) return prescription;

    return {
      ...prescription,
      sets: [...warmupSets(knownWeight, recipes), ...prescription.sets],
    };
  });

  return { ...session, prescriptions };
}
