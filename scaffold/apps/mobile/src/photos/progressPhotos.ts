import type { SqlDb } from '../db/schema';

export const PROGRESS_PHOTO_POSES = ['front', 'side', 'back', 'other'] as const;

export type ProgressPhotoPose = (typeof PROGRESS_PHOTO_POSES)[number];

export interface ProgressPhoto {
  id: string;
  user_id: string;
  taken_at: string;
  image_uri: string;
  pose: ProgressPhotoPose;
  body_weight: number | null;
  note: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface ProgressPhotoRow extends Omit<ProgressPhoto, 'tags'> {
  tags: string;
}

export interface ProgressPhotoStats {
  count: number;
  firstTakenAt: string | null;
  latest: ProgressPhoto | null;
}

export interface InsertProgressPhotoInput {
  id: string;
  userId: string;
  imageUri: string;
  pose: ProgressPhotoPose;
  takenAt?: string;
  bodyWeight?: number | null;
  note?: string | null;
  tags?: string[];
  now?: string;
}

export interface UpdateProgressPhotoInput {
  userId: string;
  id: string;
  pose: ProgressPhotoPose;
  bodyWeight?: number | null;
  note?: string | null;
  tags?: string[];
  now?: string;
}

const nowIso = () => new Date().toISOString();

export function normalizeProgressPhotoTags(tags: string[]): string[] {
  const normalized = tags
    .map((tag) => tag.trim().replace(/^#/, '').toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(normalized)).slice(0, 12);
}

export function parseProgressPhotoTags(input: string): string[] {
  return normalizeProgressPhotoTags(input.split(/[,\n]/));
}

function encodeTags(tags?: string[]) {
  return JSON.stringify(normalizeProgressPhotoTags(tags ?? []));
}

function decodeTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? normalizeProgressPhotoTags(value.filter((item): item is string => typeof item === 'string')) : [];
  } catch {
    return [];
  }
}

function mapPhoto(row: ProgressPhotoRow): ProgressPhoto {
  return { ...row, tags: decodeTags(row.tags) };
}

export function isProgressPhotoPose(value: string): value is ProgressPhotoPose {
  return PROGRESS_PHOTO_POSES.includes(value as ProgressPhotoPose);
}

export async function insertProgressPhoto(
  db: SqlDb,
  input: InsertProgressPhotoInput,
): Promise<ProgressPhoto> {
  const ts = input.now ?? nowIso();
  const takenAt = input.takenAt ?? ts;
  const note = input.note?.trim() || null;
  const tags = normalizeProgressPhotoTags(input.tags ?? []);
  await db.runAsync(
    `insert into progress_photos (
       id, user_id, taken_at, image_uri, pose, body_weight, note, tags, created_at, updated_at, deleted_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null)`,
    input.id,
    input.userId,
    takenAt,
    input.imageUri,
    input.pose,
    input.bodyWeight ?? null,
    note,
    JSON.stringify(tags),
    ts,
    ts,
  );
  return {
    id: input.id,
    user_id: input.userId,
    taken_at: takenAt,
    image_uri: input.imageUri,
    pose: input.pose,
    body_weight: input.bodyWeight ?? null,
    note,
    tags,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
  };
}

export async function listProgressPhotos(
  db: SqlDb,
  userId: string,
  limit = 500,
): Promise<ProgressPhoto[]> {
  const rows = await db.getAllAsync<ProgressPhotoRow>(
    `select id, user_id, taken_at, image_uri, pose, body_weight, note, tags, created_at, updated_at, deleted_at
       from progress_photos
      where user_id = ? and deleted_at is null
      order by taken_at desc, created_at desc
      limit ?`,
    userId,
    limit,
  );
  return rows.map(mapPhoto);
}

export async function getProgressPhotoStats(db: SqlDb, userId: string): Promise<ProgressPhotoStats> {
  const summary = await db.getFirstAsync<{ count: number; first_taken_at: string | null }>(
    `select count(*) as count, min(taken_at) as first_taken_at
       from progress_photos
      where user_id = ? and deleted_at is null`,
    userId,
  );
  const latest = await db.getFirstAsync<ProgressPhotoRow>(
    `select id, user_id, taken_at, image_uri, pose, body_weight, note, tags, created_at, updated_at, deleted_at
       from progress_photos
      where user_id = ? and deleted_at is null
      order by taken_at desc, created_at desc
      limit 1`,
    userId,
  );
  return {
    count: summary?.count ?? 0,
    firstTakenAt: summary?.first_taken_at ?? null,
    latest: latest ? mapPhoto(latest) : null,
  };
}

export async function updateProgressPhoto(
  db: SqlDb,
  input: UpdateProgressPhotoInput,
): Promise<void> {
  const ts = input.now ?? nowIso();
  const note = input.note?.trim() || null;
  await db.runAsync(
    `update progress_photos
        set pose = ?, body_weight = ?, note = ?, tags = ?, updated_at = ?
      where user_id = ? and id = ? and deleted_at is null`,
    input.pose,
    input.bodyWeight ?? null,
    note,
    encodeTags(input.tags),
    ts,
    input.userId,
    input.id,
  );
}

export async function deleteProgressPhoto(
  db: SqlDb,
  userId: string,
  id: string,
  deletedAt = nowIso(),
): Promise<void> {
  await db.runAsync(
    `update progress_photos
        set deleted_at = ?, updated_at = ?
      where user_id = ? and id = ? and deleted_at is null`,
    deletedAt,
    deletedAt,
    userId,
    id,
  );
}
