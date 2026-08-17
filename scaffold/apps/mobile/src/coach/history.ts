import {
  compactCoachReplyText,
  guardCoachOutput,
  MAX_COACH_ANSWER_CHARS,
  MAX_COACH_FOLLOW_UP_CHARS,
  type CoachReply,
} from './chat';
import type { CoachEvidence, CoachEvidenceKey } from './context';
import type { SqlDb } from '../db/schema';

export interface CoachThread {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface StoredCoachMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  historyContent: string;
  reply: CoachReply | null;
  evidence: CoachEvidence[];
  createdAt: string;
}

export interface CoachHistoryInputPolicy {
  storedContent: string;
  historyContent: string;
  threadTitle: string;
}

interface ThreadRow {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

interface MessageRow {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant';
  content: string;
  history_content: string;
  reply_json: string | null;
  evidence_json: string;
  created_at: string;
}

const nowIso = () => new Date().toISOString();
const REPLY_SOURCES = new Set(['model', 'offline', 'safety', 'boundary']);
const SAFETY_CLASSES = new Set(['standard', 'pain', 'medical', 'nutrition', 'urgent']);
const BOUNDARY_CLASSES = new Set(['fitness', 'off_topic', 'privacy', 'secrets', 'prompt_injection']);
const EVIDENCE_KEYS = new Set<CoachEvidenceKey>([
  'profile',
  'current_week',
  'next_session',
  'latest_pr',
  'recovery',
  'last_workout',
  'training_strain',
]);
const COACH_PROPOSAL_ID_PATTERN = /^cp_[a-f0-9]{16}$/;

export function coachThreadTitle(message: string) {
  const normalized = message.trim().replace(/\s+/g, ' ');
  if (!normalized) return 'New conversation';
  return normalized.length <= 72 ? normalized : `${normalized.slice(0, 69).trimEnd()}…`;
}

export function coachThreadDisplayTitle(title: string, maxWords = 5) {
  const words = title.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (words.length === 0) return 'New conversation';
  if (words.length <= maxWords) return words.join(' ');
  return `${words.slice(0, maxWords).join(' ')}…`;
}

export function coachHistoryInputPolicy(
  content: string,
  preflight: Pick<CoachReply, 'boundaryClass'> | null,
): CoachHistoryInputPolicy {
  const omitProtectedInput = preflight?.boundaryClass === 'secrets' || preflight?.boundaryClass === 'privacy';
  return {
    storedContent: omitProtectedInput ? '[Protected input omitted]' : content,
    historyContent: preflight ? '' : content,
    threadTitle: omitProtectedInput ? 'Protected request' : coachThreadTitle(content),
  };
}

function mapThread(row: ThreadRow): CoachThread {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: Number(row.message_count) || 0,
  };
}

function decodeReply(raw: string | null): CoachReply | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof value.answer !== 'string'
      || !Array.isArray(value.evidenceKeys)
      || typeof value.safetyClass !== 'string'
      || !SAFETY_CLASSES.has(value.safetyClass)
      || typeof value.boundaryClass !== 'string'
      || !BOUNDARY_CLASSES.has(value.boundaryClass)
      || typeof value.source !== 'string'
      || !REPLY_SOURCES.has(value.source)
    ) return null;
    const source = value.source as CoachReply['source'];
    const safetyClass = value.safetyClass as CoachReply['safetyClass'];
    const boundaryClass = value.boundaryClass as CoachReply['boundaryClass'];
    const proposalId = (
      (source === 'model' || source === 'offline')
      && safetyClass === 'standard'
      && boundaryClass === 'fitness'
      && typeof value.proposalId === 'string'
      && COACH_PROPOSAL_ID_PATTERN.test(value.proposalId)
    ) ? value.proposalId : null;
    return {
      answer: compactCoachReplyText(value.answer, MAX_COACH_ANSWER_CHARS),
      evidenceKeys: value.evidenceKeys
        .filter((key): key is CoachEvidenceKey => typeof key === 'string' && EVIDENCE_KEYS.has(key as CoachEvidenceKey))
        .filter((key, index, all) => all.indexOf(key) === index)
        .slice(0, 3),
      followUp: typeof value.followUp === 'string'
        ? compactCoachReplyText(value.followUp, MAX_COACH_FOLLOW_UP_CHARS)
        : null,
      safetyClass,
      boundaryClass,
      source,
      notice: typeof value.notice === 'string' ? value.notice.slice(0, 180) : null,
      proposalId,
    };
  } catch {
    return null;
  }
}

function decodeEvidence(raw: string): CoachEvidence[] {
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is CoachEvidence => (
        !!item
        && typeof item === 'object'
        && typeof item.key === 'string'
        && typeof item.label === 'string'
        && typeof item.value === 'string'
      ))
      .slice(0, 3);
  } catch {
    return [];
  }
}

function mapMessage(row: MessageRow): StoredCoachMessage {
  const decodedReply = decodeReply(row.reply_json);
  const guardedReply = row.role === 'assistant'
    ? guardCoachOutput(`${row.content}\n${decodedReply?.followUp ?? ''}`)
    : null;
  return {
    id: row.id,
    threadId: row.thread_id,
    role: row.role,
    content: guardedReply
      ? guardedReply.answer
      : row.role === 'assistant'
        ? compactCoachReplyText(row.content, MAX_COACH_ANSWER_CHARS + MAX_COACH_FOLLOW_UP_CHARS + 2)
        : row.content,
    historyContent: guardedReply ? '' : row.history_content,
    reply: guardedReply ?? decodedReply,
    evidence: guardedReply ? [] : decodeEvidence(row.evidence_json),
    createdAt: row.created_at,
  };
}

export async function createCoachThread(
  db: SqlDb,
  input: { id: string; userId: string; title: string; now?: string },
): Promise<CoachThread> {
  const timestamp = input.now ?? nowIso();
  const title = coachThreadTitle(input.title);
  await db.runAsync(
    `insert into coach_threads (id, user_id, title, created_at, updated_at)
     values (?, ?, ?, ?, ?)`,
    input.id,
    input.userId,
    title,
    timestamp,
    timestamp,
  );
  return { id: input.id, userId: input.userId, title, createdAt: timestamp, updatedAt: timestamp, messageCount: 0 };
}

export async function listCoachThreads(db: SqlDb, userId: string, limit = 8): Promise<CoachThread[]> {
  const rows = await db.getAllAsync<ThreadRow>(
    `select t.id, t.user_id, t.title, t.created_at, t.updated_at,
            (select count(*) from coach_messages m where m.thread_id = t.id and m.user_id = t.user_id) as message_count
       from coach_threads t
      where t.user_id = ?
      order by t.updated_at desc, t.created_at desc
      limit ?`,
    userId,
    Math.max(1, Math.min(25, Math.floor(limit))),
  );
  return rows.map(mapThread);
}

export async function listCoachMessages(
  db: SqlDb,
  userId: string,
  threadId: string,
  limit = 100,
): Promise<StoredCoachMessage[]> {
  const rows = await db.getAllAsync<MessageRow>(
    `select m.id, m.thread_id, m.role, m.content, m.history_content, m.reply_json, m.evidence_json, m.created_at
       from coach_messages m
       join coach_threads t on t.id = m.thread_id
      where m.thread_id = ? and m.user_id = ? and t.user_id = ?
      order by m.created_at asc, m.rowid asc
      limit ?`,
    threadId,
    userId,
    userId,
    Math.max(1, Math.min(250, Math.floor(limit))),
  );
  return rows.map(mapMessage);
}

export async function appendCoachMessage(
  db: SqlDb,
  input: {
    id: string;
    threadId: string;
    userId: string;
    role: 'user' | 'assistant';
    content: string;
    historyContent?: string;
    reply?: CoachReply | null;
    evidence?: CoachEvidence[];
    now?: string;
  },
): Promise<void> {
  const timestamp = input.now ?? nowIso();
  const content = input.content.trim().slice(0, 2_000);
  if (!content) throw new Error('Coach messages cannot be empty.');
  const historyContent = (input.historyContent ?? content).trim().slice(0, 2_000);
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `insert into coach_messages (id, thread_id, user_id, role, content, history_content, reply_json, evidence_json, created_at)
       select ?, ?, ?, ?, ?, ?, ?, ?, ?
        where exists (select 1 from coach_threads where id = ? and user_id = ?)`,
      input.id,
      input.threadId,
      input.userId,
      input.role,
      content,
      historyContent,
      input.reply ? JSON.stringify(input.reply) : null,
      JSON.stringify((input.evidence ?? []).slice(0, 3)),
      timestamp,
      input.threadId,
      input.userId,
    );
    await db.runAsync(
      'update coach_threads set updated_at = ? where id = ? and user_id = ?',
      timestamp,
      input.threadId,
      input.userId,
    );
  });
}

export async function deleteCoachThread(db: SqlDb, userId: string, threadId: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `delete from coach_messages
        where thread_id = ? and user_id = ?
          and exists (select 1 from coach_threads where id = ? and user_id = ?)`,
      threadId,
      userId,
      threadId,
      userId,
    );
    await db.runAsync('delete from coach_threads where id = ? and user_id = ?', threadId, userId);
  });
}
