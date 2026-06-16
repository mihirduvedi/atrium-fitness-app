import type { ArchetypesFile } from './types';

/**
 * Hand-rolled structural validation of archetypes.json (no runtime deps —
 * the engine stays Node-pure and dependency-free). Throws with every problem
 * found, not just the first, so a bad data drop is diagnosable in one pass.
 */
export function validateArchetypesFile(raw: unknown): ArchetypesFile {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(msg);

  if (typeof raw !== 'object' || raw === null) {
    throw new Error('archetypes.json: root is not an object');
  }
  const d = raw as Record<string, any>;

  for (const key of [
    'version',
    'exercise_catalog',
    'swap_ladders',
    'progression_rules',
    'engine_policies',
    'selector',
    'archetypes',
  ]) {
    if (!(key in d)) err(`missing top-level key: ${key}`);
  }
  if (errors.length) throw new Error(`archetypes.json invalid:\n${errors.join('\n')}`);

  const catalog = d.exercise_catalog as Record<string, any>;
  for (const [id, ex] of Object.entries(catalog)) {
    if (typeof ex.name !== 'string') err(`exercise ${id}: missing name`);
    if (typeof ex.pattern !== 'string') err(`exercise ${id}: missing pattern`);
    if (typeof ex.equipment !== 'string') err(`exercise ${id}: missing equipment`);
    if (![1, 2, 3].includes(ex.level)) err(`exercise ${id}: level must be 1|2|3, got ${ex.level}`);
  }

  for (const [pattern, ladder] of Object.entries(d.swap_ladders as Record<string, any>)) {
    if (!Array.isArray(ladder) || ladder.length === 0) {
      err(`swap_ladders.${pattern}: empty or not an array`);
      continue;
    }
    for (const exId of ladder) {
      if (!(exId in catalog)) err(`swap_ladders.${pattern}: unknown exercise ${exId}`);
    }
  }

  const ruleIds = Object.keys(d.progression_rules ?? {});
  const bounds = d.engine_policies?.safety_bounds;
  if (typeof bounds?.max_session_load_jump_pct !== 'number') {
    err('engine_policies.safety_bounds.max_session_load_jump_pct missing');
  }
  if (typeof bounds?.rep_floor_compounds !== 'number') {
    err('engine_policies.safety_bounds.rep_floor_compounds missing');
  }

  if (!Array.isArray(d.archetypes) || d.archetypes.length === 0) err('archetypes: empty');
  for (const a of d.archetypes ?? []) {
    const where = `archetype ${a?.id ?? '<no id>'}`;
    if (typeof a.id !== 'string') err(`${where}: missing id`);
    if (!Array.isArray(a.sessions) || a.sessions.length === 0) {
      err(`${where}: no sessions`);
      continue;
    }
    if (typeof a.days_per_week !== 'number') err(`${where}: missing days_per_week`);
    for (const s of a.sessions) {
      for (const [i, slot] of (s.slots ?? []).entries()) {
        const sw = `${where} / ${s.name} / slot ${i}`;
        if (!(slot.primary in catalog)) err(`${sw}: unknown primary exercise ${slot.primary}`);
        if (!ruleIds.includes(slot.rule)) err(`${sw}: unknown rule ${slot.rule}`);
        if (typeof slot.rest_s !== 'number') err(`${sw}: missing rest_s`);
        const hasStraight = typeof slot.sets === 'number' && Array.isArray(slot.reps);
        const hasTopBackoff = slot.top && slot.backoff;
        const hasDuration = typeof slot.duration_min === 'number';
        if (!hasStraight && !hasTopBackoff && !hasDuration) {
          err(`${sw}: no scheme (need sets+reps, top+backoff, or duration_min)`);
        }
        if (slot.pattern in d.swap_ladders === false) err(`${sw}: pattern ${slot.pattern} has no swap ladder`);
      }
    }
  }

  if (errors.length) throw new Error(`archetypes.json invalid:\n${errors.join('\n')}`);
  return d as ArchetypesFile;
}
