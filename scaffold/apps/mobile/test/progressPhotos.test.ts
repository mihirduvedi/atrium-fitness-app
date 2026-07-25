import { describe, expect, it } from 'vitest';
import {
  deleteProgressPhoto,
  getProgressPhotoStats,
  insertProgressPhoto,
  listProgressPhotos,
  updateProgressPhoto,
} from '../src/photos/progressPhotos';
import { migrate } from '../src/db/schema';
import { openNodeDb } from './helpers/nodeDb';

describe('progress photo storage', () => {
  it('stores local-only progress photos in newest-first order', async () => {
    const db = openNodeDb();
    await migrate(db);

    await insertProgressPhoto(db, {
      id: 'photo-1',
      userId: 'u1',
      imageUri: 'file:///atrium/progress-photos/photo-1.jpg',
      pose: 'front',
      takenAt: '2026-06-01T12:00:00.000Z',
      bodyWeight: 184.5,
      note: '  baseline  ',
      tags: ['Start', '#Cut', 'cut'],
      now: '2026-06-01T12:00:00.000Z',
    });
    await insertProgressPhoto(db, {
      id: 'photo-2',
      userId: 'u1',
      imageUri: 'file:///atrium/progress-photos/photo-2.jpg',
      pose: 'side',
      takenAt: '2026-06-08T12:00:00.000Z',
      now: '2026-06-08T12:00:00.000Z',
    });

    const photos = await listProgressPhotos(db, 'u1');
    expect(photos.map((photo) => photo.id)).toEqual(['photo-2', 'photo-1']);
    expect(photos[1]!.note).toBe('baseline');
    expect(photos[1]!.body_weight).toBe(184.5);
    expect(photos[1]!.tags).toEqual(['start', 'cut']);

    const stats = await getProgressPhotoStats(db, 'u1');
    expect(stats.count).toBe(2);
    expect(stats.firstTakenAt).toBe('2026-06-01T12:00:00.000Z');
    expect(stats.latest?.id).toBe('photo-2');

    db.close();
  });

  it('soft deletes photos without exposing them in lists or stats', async () => {
    const db = openNodeDb();
    await migrate(db);

    await insertProgressPhoto(db, {
      id: 'photo-1',
      userId: 'u1',
      imageUri: 'file:///atrium/progress-photos/photo-1.jpg',
      pose: 'front',
      takenAt: '2026-06-01T12:00:00.000Z',
      now: '2026-06-01T12:00:00.000Z',
    });
    await deleteProgressPhoto(db, 'u1', 'photo-1', '2026-06-09T12:00:00.000Z');

    expect(await listProgressPhotos(db, 'u1')).toEqual([]);
    const stats = await getProgressPhotoStats(db, 'u1');
    expect(stats.count).toBe(0);
    expect(stats.latest).toBeNull();

    db.close();
  });

  it('updates saved photo metadata without changing its timeline position', async () => {
    const db = openNodeDb();
    await migrate(db);

    await insertProgressPhoto(db, {
      id: 'photo-1',
      userId: 'u1',
      imageUri: 'file:///atrium/progress-photos/photo-1.jpg',
      pose: 'front',
      takenAt: '2026-06-01T12:00:00.000Z',
      bodyWeight: 180,
      note: 'before',
      now: '2026-06-01T12:00:00.000Z',
    });
    await updateProgressPhoto(db, {
      id: 'photo-1',
      userId: 'u1',
      pose: 'back',
      bodyWeight: 181.5,
      note: '  after edit  ',
      tags: ['bulk', 'monthly'],
      now: '2026-06-03T12:00:00.000Z',
    });

    const [photo] = await listProgressPhotos(db, 'u1');
    expect(photo?.pose).toBe('back');
    expect(photo?.body_weight).toBe(181.5);
    expect(photo?.note).toBe('after edit');
    expect(photo?.tags).toEqual(['bulk', 'monthly']);
    expect(photo?.taken_at).toBe('2026-06-01T12:00:00.000Z');
    expect(photo?.updated_at).toBe('2026-06-03T12:00:00.000Z');

    db.close();
  });
});
