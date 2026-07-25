const DASH = ' \u2014 ';
const EN_DASH = ' \u2013 ';

function expandSegment(segment: string): string {
  const trimmed = segment.trim();
  const upperMatch = /^Upper(\s+\d+)?$/.exec(trimmed);
  if (upperMatch) return `Upper Body${upperMatch[1] ?? ''}`;

  const lowerMatch = /^Lower(\s+\d+)?$/.exec(trimmed);
  if (lowerMatch) return `Lower Body${lowerMatch[1] ?? ''}`;

  const fullMatch = /^Full(\s+\d+)?$/.exec(trimmed);
  if (fullMatch) return `Full Body${fullMatch[1] ?? ''}`;

  return trimmed;
}

export function formatWorkoutDayName(name: string): string {
  for (const separator of [DASH, EN_DASH, ' - ']) {
    if (!name.includes(separator)) continue;
    const [first, ...rest] = name.split(separator);
    return [expandSegment(first ?? ''), ...rest].join(separator);
  }

  return expandSegment(name);
}

export function formatWorkoutFocusName(name: string): string {
  const full = formatWorkoutDayName(name);
  return full.split(DASH)[0]?.split(EN_DASH)[0]?.split(' - ')[0] ?? full;
}

export function displayWorkoutName(customName: string | null | undefined, fallbackName: string | null | undefined): string {
  const custom = customName?.trim();
  if (custom) return custom;
  return fallbackName ? formatWorkoutDayName(fallbackName) : 'Workout';
}
