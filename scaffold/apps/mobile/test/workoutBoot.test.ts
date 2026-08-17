import { describe, expect, it } from 'vitest';
import { runWorkoutBoot, workoutBootFailureMessage } from '../src/workoutBoot';

describe('workout boot failure boundary', () => {
  it('turns an invalid synced deload into a safe recovery state without rejecting', async () => {
    const failures: string[] = [];
    const completed = await runWorkoutBoot(async () => {
      throw new Error('This Coach deload cannot be safely resumed on this device.');
    }, (message) => failures.push(message));

    expect(completed).toBe(false);
    expect(failures).toEqual([
      'This active workout could not be verified on this device. Sync and retry before logging any sets, or discard it.',
    ]);
  });

  it('routes missing synced Program context through the same no-logging recovery boundary', async () => {
    const failures: string[] = [];
    const completed = await runWorkoutBoot(async () => {
      throw new Error('This active workout cannot be safely resumed without its Program day.');
    }, (message) => failures.push(message));

    expect(completed).toBe(false);
    expect(failures).toEqual([
      'This active workout could not be verified on this device. Sync and retry before logging any sets, or discard it.',
    ]);
  });

  it('does not expose arbitrary database errors and preserves successful boot', async () => {
    expect(workoutBootFailureMessage(new Error('select secret_table failed')))
      .toBe('Atrium could not prepare this workout. Retry after syncing, or return to Today without logging sets.');
    expect(await runWorkoutBoot(async () => {}, () => {
      throw new Error('failure callback should not run');
    })).toBe(true);
  });
});
