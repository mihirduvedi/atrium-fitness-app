import {
  exerciseCatalog,
  validateChange,
  type PrescribedSet,
  type Readiness,
  type SessionPlan,
} from '@atrium/engine';
import {
  discardWorkout,
  getActiveProgram,
  getInProgressWorkoutOverview,
  getNextProgramDay,
  getWorkoutDraft,
  getWorkoutOverview,
  planSession,
  previewProgramDay,
  saveWorkoutDraft,
  startWorkoutWithStatus,
  type WorkoutDraftSetUi,
} from '../db/queries';
import type { IdFn } from '../db/dao';
import type { SqlDb } from '../db/schema';
import { getReadinessSignal } from '../health/readiness';

export type CoachProposalKind = 'keep_plan' | 'reduce_volume';

export interface CoachProposalOption {
  id: string;
  kind: CoachProposalKind;
  planFingerprint: string;
  title: string;
  summary: string;
  actionLabel: string;
  exerciseName: string | null;
  targetSlotId: string | null;
  setReduction: 0 | 1 | 2;
  beforeBackoffSets: number | null;
  afterBackoffSets: number | null;
}

export interface CoachModelProposalOption {
  id: string;
  kind: CoachProposalKind;
  summary: string;
}

export interface CoachProposalSet {
  plan: SessionPlan;
  planFingerprint: string;
  options: CoachProposalOption[];
}

export type CoachProposalStartResult =
  | { status: 'started'; workoutId: string; proposal: CoachProposalOption }
  | { status: 'already_applied'; workoutId: string; proposalId: string }
  | { status: 'active_workout'; workoutId: string }
  | { status: 'stale'; reason: 'plan' | 'readiness' }
  | { status: 'unavailable' };

const PROPOSAL_NOTE_PREFIX = 'atrium:coach-proposal:';
const proposalStartTails = new WeakMap<SqlDb, Map<string, Promise<void>>>();

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

function hash32(value: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function opaqueHash(value: string) {
  return `${hash32(value, 0x811c9dc5)}${hash32(value, 0x9e3779b9)}`;
}

export function coachPlanFingerprint(plan: SessionPlan) {
  return `pf1_${opaqueHash(JSON.stringify(canonicalize(plan)))}`;
}

function proposalId(planFingerprint: string, kind: CoachProposalKind, slotId = '', reduction = 0) {
  return `cp_${opaqueHash(`${planFingerprint}|${kind}|${slotId}|${reduction}`)}`;
}

function displayExerciseName(exerciseId: string) {
  return exerciseCatalog[exerciseId]?.name ?? 'Primary lift';
}

export function buildCoachProposalSet(plan: SessionPlan): CoachProposalSet {
  const planFingerprint = coachPlanFingerprint(plan);
  const options: CoachProposalOption[] = [{
    id: proposalId(planFingerprint, 'keep_plan'),
    kind: 'keep_plan',
    planFingerprint,
    title: plan.name,
    summary: `Start ${plan.name} as currently planned, with no changes.`,
    actionLabel: 'Start planned workout',
    exerciseName: null,
    targetSlotId: null,
    setReduction: 0,
    beforeBackoffSets: null,
    afterBackoffSets: null,
  }];

  const target = plan.prescriptions.find((prescription) => (
    prescription.sets.filter((set) => set.kind === 'backoff' && !set.isWarmup).length >= 2
  ));
  if (!target) return { plan, planFingerprint, options };

  const beforeBackoffSets = target.sets.filter((set) => set.kind === 'backoff' && !set.isWarmup).length;
  const exerciseName = displayExerciseName(target.exerciseId);
  for (const reduction of [1, 2] as const) {
    if (beforeBackoffSets - reduction < 1) continue;
    const afterBackoffSets = beforeBackoffSets - reduction;
    options.push({
      id: proposalId(planFingerprint, 'reduce_volume', target.slotId, reduction),
      kind: 'reduce_volume',
      planFingerprint,
      title: `Reduce ${exerciseName} volume`,
      summary: `${exerciseName} back-off sets ${beforeBackoffSets} to ${afterBackoffSets}; warm-ups, top set, load, and reps stay unchanged.`,
      actionLabel: 'Apply & start workout',
      exerciseName,
      targetSlotId: target.slotId,
      setReduction: reduction,
      beforeBackoffSets,
      afterBackoffSets,
    });
  }
  return { plan, planFingerprint, options };
}

export function toCoachModelProposalOptions(options: CoachProposalOption[]): CoachModelProposalOption[] {
  return options.slice(0, 3).map(({ id, kind, summary }) => ({ id, kind, summary }));
}

export function resolveCoachProposal(
  proposalSet: CoachProposalSet | null,
  proposalIdValue: string | null | undefined,
) {
  if (!proposalSet || !proposalIdValue) return null;
  return proposalSet.options.find((option) => option.id === proposalIdValue) ?? null;
}

function sameSet(left: PrescribedSet, right: PrescribedSet) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export function applyCoachProposal(plan: SessionPlan, option: CoachProposalOption): SessionPlan {
  const currentSet = buildCoachProposalSet(plan);
  const currentOption = currentSet.options.find((candidate) => candidate.id === option.id);
  if (!currentOption || option.planFingerprint !== currentSet.planFingerprint) {
    throw new Error('Coach proposal is stale.');
  }
  if (currentOption.kind === 'keep_plan') return plan;
  if (!currentOption.targetSlotId || currentOption.setReduction < 1) {
    throw new Error('Coach proposal is invalid.');
  }

  const prescriptions = plan.prescriptions.map((prescription) => {
    if (prescription.slotId !== currentOption.targetSlotId) return prescription;
    const removable = prescription.sets
      .map((set, index) => ({ set, index }))
      .filter(({ set }) => set.kind === 'backoff' && !set.isWarmup)
      .slice(-currentOption.setReduction);
    if (removable.length !== currentOption.setReduction) throw new Error('Coach proposal cannot be applied.');
    const removedIndexes = new Set(removable.map(({ index }) => index));
    return {
      ...prescription,
      sets: prescription.sets.filter((_, index) => !removedIndexes.has(index)),
    };
  });
  const proposed = { ...plan, prescriptions };
  const result = validateChange(proposed, plan);
  if (!result.ok) throw new Error(`Coach proposal failed engine validation: ${result.violations.join('; ')}`);

  if (proposed.prescriptions.length !== plan.prescriptions.length) throw new Error('Coach proposal changed plan slots.');
  for (let index = 0; index < plan.prescriptions.length; index += 1) {
    const before = plan.prescriptions[index]!;
    const after = proposed.prescriptions[index]!;
    if (before.slotId !== after.slotId || before.exerciseId !== after.exerciseId) {
      throw new Error('Coach proposal changed plan identity.');
    }
    if (before.slotId !== currentOption.targetSlotId) {
      if (JSON.stringify(canonicalize(before)) !== JSON.stringify(canonicalize(after))) {
        throw new Error('Coach proposal changed an untargeted movement.');
      }
      continue;
    }
    const preservedBefore = before.sets.filter((set) => set.kind !== 'backoff' || set.isWarmup);
    const preservedAfter = after.sets.filter((set) => set.kind !== 'backoff' || set.isWarmup);
    if (preservedBefore.length !== preservedAfter.length || preservedBefore.some((set, setIndex) => !sameSet(set, preservedAfter[setIndex]!))) {
      throw new Error('Coach proposal changed a protected set.');
    }
    const remainingBackoffs = after.sets.filter((set) => set.kind === 'backoff' && !set.isWarmup);
    if (remainingBackoffs.length !== currentOption.afterBackoffSets || remainingBackoffs.length < 1) {
      throw new Error('Coach proposal removed too many back-off sets.');
    }
  }
  return proposed;
}

export function markPlanWithCoachProposal(plan: SessionPlan, proposalIdValue: string): SessionPlan {
  const marker = `${PROPOSAL_NOTE_PREFIX}${proposalIdValue}`;
  return {
    ...plan,
    notes: [...(plan.notes ?? []).filter((note) => !note.startsWith(PROPOSAL_NOTE_PREFIX)), marker],
  };
}

export function coachProposalIdFromPlan(plan: SessionPlan | null | undefined) {
  const marker = plan?.notes?.find((note) => note.startsWith(PROPOSAL_NOTE_PREFIX));
  return marker ? marker.slice(PROPOSAL_NOTE_PREFIX.length) : null;
}

function initialSetUiForPlan(plan: SessionPlan): WorkoutDraftSetUi {
  const setUi: WorkoutDraftSetUi = {};
  for (const prescription of plan.prescriptions) {
    for (const set of prescription.sets) {
      setUi[`${prescription.slotId}:${set.setIndex}`] = {
        weight: set.weight === undefined ? '' : String(set.weight),
        reps: String(set.targetSeconds ?? set.targetReps[1]),
        done: false,
      };
    }
  }
  return setUi;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function startCoachProposalWorkoutOnce(
  db: SqlDb,
  userId: string,
  proposalIdValue: string,
  idFn: IdFn,
  now: Date,
): Promise<CoachProposalStartResult> {
  const active = await getInProgressWorkoutOverview(db, userId);
  if (active) {
    const draft = await getWorkoutDraft(db, active.workoutId);
    return coachProposalIdFromPlan(draft?.plan) === proposalIdValue
      ? { status: 'already_applied', workoutId: active.workoutId, proposalId: proposalIdValue }
      : { status: 'active_workout', workoutId: active.workoutId };
  }

  const program = await getActiveProgram(db, userId);
  if (!program) return { status: 'unavailable' };
  const next = await getNextProgramDay(db, program.id);
  if (!next) return { status: 'unavailable' };
  const readiness = await getReadinessSignal(db, userId, dateKey(now));
  if (readiness.readiness === 'red') return { status: 'stale', reason: 'readiness' };

  const preview = await previewProgramDay(db, userId, next, readiness.readiness);
  const previewSet = buildCoachProposalSet(preview);
  const previewOption = resolveCoachProposal(previewSet, proposalIdValue);
  if (!previewOption) return { status: 'stale', reason: 'plan' };
  applyCoachProposal(preview, previewOption);

  const activeBeforeWrite = await getInProgressWorkoutOverview(db, userId);
  if (activeBeforeWrite) return { status: 'active_workout', workoutId: activeBeforeWrite.workoutId };

  const start = await startWorkoutWithStatus(db, userId, next.dayId, idFn, readiness.score);
  if (!start.created) return { status: 'active_workout', workoutId: start.workoutId };
  const workoutId = start.workoutId;
  const overview = await getWorkoutOverview(db, workoutId, userId);
  if (!overview || overview.programDayId !== next.dayId) {
    return { status: 'active_workout', workoutId };
  }

  const planned = await planSession(db, userId, next, idFn, readiness.readiness);
  const plannedSet = buildCoachProposalSet(planned);
  const plannedOption = resolveCoachProposal(plannedSet, proposalIdValue);
  if (!plannedOption) {
    await discardWorkout(db, workoutId, idFn);
    return { status: 'stale', reason: 'plan' };
  }
  const proposedPlan = markPlanWithCoachProposal(applyCoachProposal(planned, plannedOption), proposalIdValue);
  await saveWorkoutDraft(db, {
    workoutId,
    userId,
    programDayId: next.dayId,
    day: next,
    plan: proposedPlan,
    setUi: initialSetUiForPlan(proposedPlan),
    activeIndex: 0,
    restRemainingS: null,
  });
  return { status: 'started', workoutId, proposal: plannedOption };
}

export function startCoachProposalWorkout(
  db: SqlDb,
  userId: string,
  proposalIdValue: string,
  idFn: IdFn,
  now: Date = new Date(),
): Promise<CoachProposalStartResult> {
  let dbTails = proposalStartTails.get(db);
  if (!dbTails) {
    dbTails = new Map();
    proposalStartTails.set(db, dbTails);
  }
  const previous = dbTails.get(userId) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(() => (
    startCoachProposalWorkoutOnce(db, userId, proposalIdValue, idFn, now)
  ));
  const tail = result.then(() => {}, () => {});
  dbTails.set(userId, tail);
  return result.finally(() => {
    if (dbTails?.get(userId) === tail) dbTails.delete(userId);
  });
}

export function preferredOfflineProposalId(
  message: string,
  readiness: Readiness,
  options: CoachProposalOption[],
) {
  if (readiness === 'red') return null;
  const lower = message.toLowerCase();
  const asksForWorkout = (
    /\b(?:what|which)\s+(?:workout|session)\s+should\s+i\s+(?:do|train)\b/.test(lower)
    || /\bwhat\s+should\s+i\s+(?:do|train)\s+today\b/.test(lower)
    || (/\b(?:workout|session)\b/.test(lower) && /\breadiness\b/.test(lower))
  );
  const wantsLess = /\b(tired|fatigue|fatigued|run down|exhausted|recovery|reduce|trim|less volume)\b/.test(lower);
  if (wantsLess || (asksForWorkout && readiness === 'yellow')) {
    return options.find((option) => option.kind === 'reduce_volume' && option.setReduction === 1)?.id ?? null;
  }
  if (asksForWorkout || /\b(harder|increase|heavier|add weight|progress)\b/.test(lower)) {
    return options.find((option) => option.kind === 'keep_plan')?.id ?? null;
  }
  return null;
}
