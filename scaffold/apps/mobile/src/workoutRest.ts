interface RestAfterSetArgs {
  exerciseDone: boolean;
  setRestSeconds: number | null | undefined;
  fallbackSeconds: number;
}

function usableSeconds(value: number | null | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value!)) : Math.max(0, Math.round(fallback));
}

export function restSecondsAfterLoggedSet(args: RestAfterSetArgs): number | null {
  if (args.exerciseDone) return null;
  return usableSeconds(args.setRestSeconds, args.fallbackSeconds);
}
