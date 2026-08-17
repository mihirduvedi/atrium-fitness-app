import {
  applySessionDeload,
  exerciseCatalog,
  validateChange,
  type DeloadDecision,
  type PrescribedSet,
  type Readiness,
  type SessionPlan,
} from '@atrium/engine';
import {
  getActiveProgram,
  getInProgressWorkoutOverview,
  getNextProgramDay,
  getWorkoutDraft,
  previewProgramDay,
  startProgramWorkoutDraftAtomic,
  type WorkoutDraftSetUi,
} from '../db/queries';
import type { IdFn } from '../db/dao';
import type { SqlDb } from '../db/schema';
import { getReadinessSignal } from '../health/readiness';
import { buildCoachAdaptationSignal, COACH_DELOAD_PLAN_MARKER } from './adaptation';

export type CoachProposalKind = 'keep_plan' | 'reduce_volume' | 'deload_session';

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
  deloadReason: Exclude<DeloadDecision['reason'], 'none'> | null;
  volumeReductionPct: number | null;
  intensityReductionPct: number | null;
  dropTopSets: boolean;
  triggerLabel: string | null;
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
const PROPOSAL_KIND_PREFIX = 'atrium:coach-proposal-kind:';
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

function proposalId(planFingerprint: string, kind: CoachProposalKind, discriminator = '', reduction = 0) {
  return `cp_${opaqueHash(`${planFingerprint}|${kind}|${discriminator}|${reduction}`)}`;
}

function displayExerciseName(exerciseId: string) {
  return exerciseCatalog[exerciseId]?.name ?? 'Primary lift';
}

function deloadTriggerLabel(reason: Exclude<DeloadDecision['reason'], 'none'>) {
  if (reason === 'two_plus_stalls_same_week') return 'Multiple lifts met their stall criteria';
  if (reason === 'readiness_red_3plus') return 'Recent readiness stayed low';
  return 'Week 7 reached its deload checkpoint';
}

export function buildCoachProposalSet(
  plan: SessionPlan,
  deloadDecision: DeloadDecision | null = null,
): CoachProposalSet {
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
    deloadReason: null,
    volumeReductionPct: null,
    intensityReductionPct: null,
    dropTopSets: false,
    triggerLabel: null,
  }];

  if (deloadDecision?.deload && deloadDecision.prescription && deloadDecision.reason !== 'none') {
    const reason = deloadDecision.reason;
    options.push({
      id: proposalId(planFingerprint, 'deload_session', reason),
      kind: 'deload_session',
      planFingerprint,
      title: `Deload ${plan.name}`,
      summary: `${deloadTriggerLabel(reason)}. For this workout only: target about 40% fewer working sets, plate-rounded loads about 10% lower, and no top sets; the Program stays unchanged.`,
      actionLabel: 'Apply & start deload',
      exerciseName: null,
      targetSlotId: null,
      setReduction: 0,
      beforeBackoffSets: null,
      afterBackoffSets: null,
      deloadReason: reason,
      volumeReductionPct: Math.abs(deloadDecision.prescription.volumePct),
      intensityReductionPct: Math.abs(deloadDecision.prescription.intensityPct),
      dropTopSets: deloadDecision.prescription.dropTopSets,
      triggerLabel: deloadTriggerLabel(reason),
    });
  }

  const target = plan.prescriptions.find((prescription) => (
    prescription.sets.filter((set) => set.kind === 'backoff' && !set.isWarmup).length >= 2
  ));
  if (!target) return { plan, planFingerprint, options };

  const beforeBackoffSets = target.sets.filter((set) => set.kind === 'backoff' && !set.isWarmup).length;
  const exerciseName = displayExerciseName(target.exerciseId);
  const reductions: readonly (1 | 2)[] = deloadDecision?.deload ? [1] : [1, 2];
  for (const reduction of reductions) {
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
      deloadReason: null,
      volumeReductionPct: null,
      intensityReductionPct: null,
      dropTopSets: false,
      triggerLabel: null,
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

export function applyCoachProposal(
  plan: SessionPlan,
  option: CoachProposalOption,
  deloadDecision: DeloadDecision | null = null,
): SessionPlan {
  const currentSet = buildCoachProposalSet(plan, deloadDecision);
  const currentOption = currentSet.options.find((candidate) => candidate.id === option.id);
  if (!currentOption || option.planFingerprint !== currentSet.planFingerprint) {
    throw new Error('Coach proposal is stale.');
  }
  if (currentOption.kind === 'keep_plan') return plan;
  if (currentOption.kind === 'deload_session') {
    if (!deloadDecision?.deload || !deloadDecision.prescription || currentOption.deloadReason !== deloadDecision.reason) {
      throw new Error('Coach deload proposal is no longer supported by the current signal.');
    }
    const proposed = applySessionDeload(plan, deloadDecision.prescription);
    const result = validateChange(proposed, plan);
    if (!result.ok) throw new Error(`Coach proposal failed engine validation: ${result.violations.join('; ')}`);
    if (proposed.prescriptions.length !== plan.prescriptions.length) {
      throw new Error('Coach deload changed plan slots.');
    }
    for (let index = 0; index < plan.prescriptions.length; index += 1) {
      const before = plan.prescriptions[index]!;
      const after = proposed.prescriptions[index]!;
      if (
        before.slotId !== after.slotId
        || before.exerciseId !== after.exerciseId
        || before.rest_s !== after.rest_s
        || JSON.stringify(before.nextState) !== JSON.stringify(after.nextState)
      ) {
        throw new Error('Coach deload changed Program identity or progression state.');
      }
      if (after.sets.some((set) => !set.isWarmup && set.kind === 'top')) {
        throw new Error('Coach deload retained a protected top set.');
      }
      if (before.sets.some((set) => !set.isWarmup) && !after.sets.some((set) => !set.isWarmup)) {
        throw new Error('Coach deload removed every working set.');
      }
    }
    return proposed;
  }
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

export function markPlanWithCoachProposal(
  plan: SessionPlan,
  proposalIdValue: string,
  kind?: CoachProposalKind,
): SessionPlan {
  const marker = `${PROPOSAL_NOTE_PREFIX}${proposalIdValue}`;
  return {
    ...plan,
    notes: [
      ...(plan.notes ?? []).filter((note) => (
        !note.startsWith(PROPOSAL_NOTE_PREFIX)
        && !note.startsWith(PROPOSAL_KIND_PREFIX)
      )),
      marker,
      ...(kind ? [kind === 'deload_session' ? COACH_DELOAD_PLAN_MARKER : `${PROPOSAL_KIND_PREFIX}${kind}`] : []),
    ],
  };
}

export function coachProposalIdFromPlan(plan: SessionPlan | null | undefined) {
  const marker = plan?.notes?.find((note) => note.startsWith(PROPOSAL_NOTE_PREFIX));
  return marker ? marker.slice(PROPOSAL_NOTE_PREFIX.length) : null;
}

export function coachProposalKindFromPlan(plan: SessionPlan | null | undefined): CoachProposalKind | null {
  const marker = plan?.notes?.find((note) => note.startsWith(PROPOSAL_KIND_PREFIX));
  const kind = marker?.slice(PROPOSAL_KIND_PREFIX.length);
  return kind === 'keep_plan' || kind === 'reduce_volume' || kind === 'deload_session' ? kind : null;
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
  const adaptation = await buildCoachAdaptationSignal(db, userId, {
    programId: program.id,
    week: next.week,
    now,
  });

  const preview = await previewProgramDay(db, userId, next, readiness.readiness);
  const previewSet = buildCoachProposalSet(preview, adaptation.deload);
  const previewOption = resolveCoachProposal(previewSet, proposalIdValue);
  if (!previewOption) return { status: 'stale', reason: 'plan' };
  applyCoachProposal(preview, previewOption, adaptation.deload);

  const activeBeforeWrite = await getInProgressWorkoutOverview(db, userId);
  if (activeBeforeWrite) return { status: 'active_workout', workoutId: activeBeforeWrite.workoutId };

  const start = await startProgramWorkoutDraftAtomic(db, {
    userId,
    expectedProgramId: program.id,
    expectedDay: next,
    idFn,
    resolveContext: async (transaction, liveDay) => {
      const liveReadiness = await getReadinessSignal(transaction, userId, dateKey(now));
      if (liveReadiness.readiness === 'red') return null;
      const liveAdaptation = await buildCoachAdaptationSignal(transaction, userId, {
        programId: program.id,
        week: liveDay.week,
        now,
      });
      return {
        readiness: liveReadiness.readiness,
        readinessScore: liveReadiness.score,
        value: liveAdaptation,
      };
    },
    prepare: (livePlan, liveAdaptation) => {
      const liveSet = buildCoachProposalSet(livePlan, liveAdaptation.deload);
      const liveOption = resolveCoachProposal(liveSet, proposalIdValue);
      if (!liveOption) return null;
      const proposedPlan = markPlanWithCoachProposal(
        applyCoachProposal(livePlan, liveOption, liveAdaptation.deload),
        proposalIdValue,
        liveOption.kind,
      );
      return {
        plan: proposedPlan,
        setUi: initialSetUiForPlan(proposedPlan),
        trainingIntent: liveOption.kind === 'deload_session' ? 'coach_deload' : 'normal',
        value: liveOption,
      };
    },
  });
  if (start.status === 'active_workout') return start;
  if (start.status === 'stale') {
    return { status: 'stale', reason: start.phase === 'context' ? 'readiness' : 'plan' };
  }
  return { status: 'started', workoutId: start.workoutId, proposal: start.value };
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
  const wantsDeload = /\b(deload|descarga)\b/.test(lower);
  const deload = options.find((option) => option.kind === 'deload_session');
  if (deload && (wantsDeload || wantsLess || asksForWorkout)) return deload.id;
  if (wantsLess || (asksForWorkout && readiness === 'yellow')) {
    return options.find((option) => option.kind === 'reduce_volume' && option.setReduction === 1)?.id ?? null;
  }
  if (asksForWorkout || /\b(harder|increase|heavier|add weight|progress)\b/.test(lower)) {
    return options.find((option) => option.kind === 'keep_plan')?.id ?? null;
  }
  return null;
}
