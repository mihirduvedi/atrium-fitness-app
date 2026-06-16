import { describe, expect, it } from 'vitest';
import { archetypeById, data, exerciseCatalog, swapLadders } from '../src';

describe('archetypes.json data integrity', () => {
  it('loads and passes schema validation', () => {
    expect(data.version).toBe('1.0');
    expect(data.archetypes.length).toBe(18);
    expect(Object.keys(exerciseCatalog).length).toBeGreaterThan(50);
  });

  it('every slot primary exercise exists in the catalog and its swap ladder', () => {
    for (const a of data.archetypes) {
      for (const s of a.sessions) {
        for (const slot of s.slots) {
          expect(exerciseCatalog[slot.primary], `${a.id}/${s.name}/${slot.primary}`).toBeDefined();
          expect(swapLadders[slot.pattern], `${a.id} ladder ${slot.pattern}`).toBeDefined();
        }
      }
    }
  });

  it('the demo archetype ul4_strength exists with 4 sessions', () => {
    const ul4 = archetypeById.get('ul4_strength');
    expect(ul4).toBeDefined();
    expect(ul4!.sessions).toHaveLength(4);
  });
});
