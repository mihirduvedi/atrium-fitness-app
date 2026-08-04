import { describe, expect, it } from 'vitest';
import { restSecondsAfterLoggedSet } from '../src/workoutRest';

describe('workout rest timing', () => {
  it('uses the program set timer while the exercise still has work remaining', () => {
    expect(restSecondsAfterLoggedSet({
      exerciseDone: false,
      setRestSeconds: 75,
      fallbackSeconds: 90,
    })).toBe(75);
  });

  it('does not show a rest timer when advancing between exercises', () => {
    expect(restSecondsAfterLoggedSet({
      exerciseDone: true,
      setRestSeconds: 75,
      fallbackSeconds: 90,
    })).toBeNull();
    expect(restSecondsAfterLoggedSet({
      exerciseDone: true,
      setRestSeconds: 75,
      fallbackSeconds: 90,
    })).toBeNull();
  });
});
