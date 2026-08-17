const SAFE_ACTIVE_RESUME_FAILURE =
  'This active workout could not be verified on this device. Sync and retry before logging any sets, or discard it.';

const SAFE_WORKOUT_BOOT_FAILURE =
  'Atrium could not prepare this workout. Retry after syncing, or return to Today without logging sets.';

export function workoutBootFailureMessage(error: unknown): string {
  return error instanceof Error && error.message.includes('cannot be safely resumed')
    ? SAFE_ACTIVE_RESUME_FAILURE
    : SAFE_WORKOUT_BOOT_FAILURE;
}

/** Convert boot failures into explicit UI state instead of an unhandled rejection. */
export async function runWorkoutBoot(
  operation: () => Promise<void>,
  onFailure: (message: string) => void,
): Promise<boolean> {
  try {
    await operation();
    return true;
  } catch (error) {
    onFailure(workoutBootFailureMessage(error));
    return false;
  }
}
