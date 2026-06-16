import raw from '../data/archetypes.json';
import type { ArchetypesFile } from './types';
import { validateArchetypesFile } from './validate';

/**
 * The program data, schema-validated at import time. archetypes.json is
 * copied verbatim from the product source — never edit the copy; fix the
 * source and re-copy.
 */
export const data: ArchetypesFile = validateArchetypesFile(raw);

export const archetypeById = new Map(data.archetypes.map((a) => [a.id, a]));
export const exerciseCatalog = data.exercise_catalog;
export const swapLadders = data.swap_ladders;
export const safetyBounds = data.engine_policies.safety_bounds;
export const restDefaults = data.engine_policies.rest_defaults_s;
