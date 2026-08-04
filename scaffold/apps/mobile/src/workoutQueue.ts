export interface WorkoutQueuePrescription {
  slotId: string;
  sets: ReadonlyArray<{ setIndex: number }>;
}

export type WorkoutQueueSetUi = Record<string, { done: boolean } | undefined>;

const FINISHED_EXERCISE_PREFIX = '__workout_queue_finished__:';

export function workoutQueueFinishedKey(slotId: string): string {
  return `${FINISHED_EXERCISE_PREFIX}${slotId}`;
}

export interface WorkoutQueueResult<T extends WorkoutQueuePrescription> {
  prescriptions: T[];
  activeIndex: number;
  moved: boolean;
}

export function isWorkoutQueuePrescriptionDone(
  prescription: WorkoutQueuePrescription,
  setUi: WorkoutQueueSetUi,
): boolean {
  return setUi[workoutQueueFinishedKey(prescription.slotId)]?.done === true
    || prescription.sets.every((set) => setUi[`${prescription.slotId}:${set.setIndex}`]?.done === true);
}

export function completedWorkoutQueuePrefixLength(
  prescriptions: ReadonlyArray<WorkoutQueuePrescription>,
  setUi: WorkoutQueueSetUi,
): number {
  const firstIncomplete = prescriptions.findIndex((prescription) => !isWorkoutQueuePrescriptionDone(prescription, setUi));
  return firstIncomplete === -1 ? prescriptions.length : firstIncomplete;
}

function queueCursorIndex(
  prescriptions: ReadonlyArray<WorkoutQueuePrescription>,
  setUi: WorkoutQueueSetUi,
): number {
  if (prescriptions.length === 0) return 0;
  return Math.min(completedWorkoutQueuePrefixLength(prescriptions, setUi), prescriptions.length - 1);
}

export function constrainWorkoutQueueTarget<T extends WorkoutQueuePrescription>(
  prescriptions: ReadonlyArray<T>,
  setUi: WorkoutQueueSetUi,
  from: number,
  target: number,
): number {
  if (from < 0 || from >= prescriptions.length) return from;
  const source = prescriptions[from];
  if (!source || isWorkoutQueuePrescriptionDone(source, setUi)) return from;
  const lockedPrefixLength = completedWorkoutQueuePrefixLength(prescriptions, setUi);
  return Math.max(lockedPrefixLength, Math.min(target, prescriptions.length - 1));
}

export function moveWorkoutQueuePrescription<T extends WorkoutQueuePrescription>(
  prescriptions: ReadonlyArray<T>,
  setUi: WorkoutQueueSetUi,
  activeIndex: number,
  from: number,
  target: number,
): WorkoutQueueResult<T> {
  const nextTarget = constrainWorkoutQueueTarget(prescriptions, setUi, from, target);
  if (from === nextTarget) {
    return {
      prescriptions: [...prescriptions],
      activeIndex: Math.max(0, Math.min(activeIndex, prescriptions.length - 1)),
      moved: false,
    };
  }

  const nextPrescriptions = [...prescriptions];
  const [movedPrescription] = nextPrescriptions.splice(from, 1);
  if (!movedPrescription) {
    return {
      prescriptions: nextPrescriptions,
      activeIndex: Math.max(0, Math.min(activeIndex, prescriptions.length - 1)),
      moved: false,
    };
  }
  nextPrescriptions.splice(nextTarget, 0, movedPrescription);
  return {
    prescriptions: nextPrescriptions,
    activeIndex: queueCursorIndex(nextPrescriptions, setUi),
    moved: true,
  };
}

export function postponeActiveWorkoutQueuePrescription<T extends WorkoutQueuePrescription>(
  prescriptions: ReadonlyArray<T>,
  setUi: WorkoutQueueSetUi,
  activeIndex: number,
): WorkoutQueueResult<T> {
  if (prescriptions.length < 2) {
    return { prescriptions: [...prescriptions], activeIndex: 0, moved: false };
  }
  return moveWorkoutQueuePrescription(
    prescriptions,
    setUi,
    activeIndex,
    activeIndex,
    prescriptions.length - 1,
  );
}

export function normalizeWorkoutQueue<T extends WorkoutQueuePrescription>(
  prescriptions: ReadonlyArray<T>,
  setUi: WorkoutQueueSetUi,
): WorkoutQueueResult<T> {
  const completed = prescriptions.filter((prescription) => isWorkoutQueuePrescriptionDone(prescription, setUi));
  const remaining = prescriptions.filter((prescription) => !isWorkoutQueuePrescriptionDone(prescription, setUi));
  const nextPrescriptions = [...completed, ...remaining];
  return {
    prescriptions: nextPrescriptions,
    activeIndex: queueCursorIndex(nextPrescriptions, setUi),
    moved: nextPrescriptions.some((prescription, index) => prescription.slotId !== prescriptions[index]?.slotId),
  };
}
