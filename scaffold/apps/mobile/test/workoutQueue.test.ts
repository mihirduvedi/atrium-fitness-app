import { describe, expect, it } from 'vitest';
import {
  constrainWorkoutQueueTarget,
  isWorkoutQueuePrescriptionDone,
  moveWorkoutQueuePrescription,
  postponeActiveWorkoutQueuePrescription,
  workoutQueueFinishedKey,
} from '../src/workoutQueue';

const prescription = (slotId: string) => ({
  slotId,
  sets: [{ setIndex: 0 }, { setIndex: 1 }],
});

describe('active workout queue ordering', () => {
  it('treats a manually finished exercise as done without checking its unlogged sets', () => {
    const item = prescription('partial');
    const setUi = {
      'partial:0': { done: true },
      'partial:1': { done: false },
      [workoutQueueFinishedKey('partial')]: { done: true },
    };

    expect(isWorkoutQueuePrescriptionDone(item, setUi)).toBe(true);
    expect(setUi['partial:0']).toEqual({ done: true });
    expect(setUi['partial:1']).toEqual({ done: false });
  });

  it('locks the completed prefix and rejects moves across it', () => {
    const prescriptions = ['done', 'active', 'queued'].map(prescription);
    const setUi = {
      'done:0': { done: true },
      'done:1': { done: true },
      'active:0': { done: true },
      'active:1': { done: false },
      'queued:0': { done: false },
      'queued:1': { done: false },
    };

    expect(constrainWorkoutQueueTarget(prescriptions, setUi, 1, 0)).toBe(1);
    expect(moveWorkoutQueuePrescription(prescriptions, setUi, 1, 1, 0)).toMatchObject({
      moved: false,
      activeIndex: 1,
    });
    expect(moveWorkoutQueuePrescription(prescriptions, setUi, 1, 0, 2)).toMatchObject({
      moved: false,
      activeIndex: 1,
    });
  });

  it('switches to a movement placed ahead of partial work, then leaves that work resumable', () => {
    const prescriptions = ['done', 'partial', 'next', 'last'].map(prescription);
    const setUi = {
      'done:0': { done: true },
      'done:1': { done: true },
      'partial:0': { done: true },
      'partial:1': { done: false },
      'next:0': { done: false },
      'next:1': { done: false },
      'last:0': { done: false },
      'last:1': { done: false },
    };

    const result = moveWorkoutQueuePrescription(prescriptions, setUi, 1, 1, 2);
    expect(result.prescriptions.map((item) => item.slotId)).toEqual(['done', 'next', 'partial', 'last']);
    expect(result.activeIndex).toBe(1);
    expect(result.prescriptions[result.activeIndex]?.slotId).toBe('next');
    expect(setUi['partial:0']).toEqual({ done: true });
    expect(setUi['partial:1']).toEqual({ done: false });
  });

  it('postpones partial work behind the remaining queue instead of stranding it before the cursor', () => {
    const prescriptions = ['done', 'partial', 'next', 'last'].map(prescription);
    const setUi = {
      'done:0': { done: true },
      'done:1': { done: true },
      'partial:0': { done: true },
      'partial:1': { done: false },
      'next:0': { done: false },
      'next:1': { done: false },
      'last:0': { done: false },
      'last:1': { done: false },
    };

    const result = postponeActiveWorkoutQueuePrescription(prescriptions, setUi, 1);
    expect(result.prescriptions.map((item) => item.slotId)).toEqual(['done', 'next', 'last', 'partial']);
    expect(result.activeIndex).toBe(1);
    expect(result.prescriptions[result.activeIndex]?.slotId).toBe('next');
    expect(setUi['partial:0']).toEqual({ done: true });
    expect(setUi['partial:1']).toEqual({ done: false });
  });
});
