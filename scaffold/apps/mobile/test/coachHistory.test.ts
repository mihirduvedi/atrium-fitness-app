import { describe, expect, it } from 'vitest';
import {
  appendCoachMessage,
  coachHistoryInputPolicy,
  coachThreadDisplayTitle,
  coachThreadTitle,
  createCoachThread,
  deleteCoachThread,
  listCoachMessages,
  listCoachThreads,
} from '../src/coach/history';
import { migrate } from '../src/db/schema';
import { openNodeDb } from './helpers/nodeDb';

describe('local Coach conversation history', () => {
  it('persists ordered messages with reply and evidence snapshots', async () => {
    const db = openNodeDb();
    await migrate(db);
    await createCoachThread(db, {
      id: 'thread-1',
      userId: 'user-1',
      title: 'Why am I stuck on bench?',
      now: '2026-08-04T10:00:00.000Z',
    });
    await appendCoachMessage(db, {
      id: 'message-1',
      threadId: 'thread-1',
      userId: 'user-1',
      role: 'user',
      content: 'Why am I stuck on bench?',
      historyContent: 'Why am I stuck on bench?',
      now: '2026-08-04T10:00:01.000Z',
    });
    await appendCoachMessage(db, {
      id: 'message-2',
      threadId: 'thread-1',
      userId: 'user-1',
      role: 'assistant',
      content: 'The log does not prove a plateau yet.',
      historyContent: 'The log does not prove a plateau yet.',
      reply: {
        answer: 'The log does not prove a plateau yet.',
        evidenceKeys: ['latest_pr'],
        followUp: null,
        safetyClass: 'standard',
        boundaryClass: 'fitness',
        source: 'offline',
        notice: 'On-device guidance',
        proposalId: null,
      },
      evidence: [{ key: 'latest_pr', label: 'Latest PR', value: 'Bench Press · 233 lb' }],
      now: '2026-08-04T10:00:02.000Z',
    });

    const threads = await listCoachThreads(db, 'user-1');
    const messages = await listCoachMessages(db, 'user-1', 'thread-1');
    expect(threads[0]).toMatchObject({ id: 'thread-1', messageCount: 2 });
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages.map((message) => message.historyContent)).toEqual([
      'Why am I stuck on bench?',
      'The log does not prove a plateau yet.',
    ]);
    expect(messages[1]?.reply).toMatchObject({ source: 'offline', boundaryClass: 'fitness' });
    expect(messages[1]?.evidence).toEqual([
      { key: 'latest_pr', label: 'Latest PR', value: 'Bench Press · 233 lb' },
    ]);
    db.close();
  });

  it('orders recent threads, scopes reads by user, and permanently deletes owned history', async () => {
    const db = openNodeDb();
    await migrate(db);
    await createCoachThread(db, { id: 'older', userId: 'user-1', title: 'Older', now: '2026-08-04T09:00:00.000Z' });
    await createCoachThread(db, { id: 'newer', userId: 'user-1', title: 'Newer', now: '2026-08-04T10:00:00.000Z' });
    await createCoachThread(db, { id: 'other', userId: 'user-2', title: 'Private', now: '2026-08-04T11:00:00.000Z' });
    expect((await listCoachThreads(db, 'user-1')).map((thread) => thread.id)).toEqual(['newer', 'older']);
    expect(await listCoachMessages(db, 'user-1', 'other')).toEqual([]);

    await deleteCoachThread(db, 'user-1', 'newer');
    expect((await listCoachThreads(db, 'user-1')).map((thread) => thread.id)).toEqual(['older']);
    expect((await listCoachThreads(db, 'user-2')).map((thread) => thread.id)).toEqual(['other']);
    db.close();
  });

  it('normalizes titles without retaining an unlimited prompt', () => {
    expect(coachThreadTitle('  Feeling   run down  ')).toBe('Feeling run down');
    expect(coachThreadTitle('x'.repeat(100))).toHaveLength(70);
  });

  it('keeps conversation-list topics compact without inventing an ellipsis', () => {
    expect(coachThreadDisplayTitle('What workout should I do today based on readiness?')).toBe('What workout should I do…');
    expect(coachThreadDisplayTitle('  Why   am I stuck?  ')).toBe('Why am I stuck?');
    expect(coachThreadDisplayTitle('')).toBe('New conversation');
  });

  it('does not retain protected input or replay any preflight-routed request', () => {
    const privatePolicy = coachHistoryInputPolicy('My email is athlete@example.com', {
      boundaryClass: 'privacy',
    });
    expect(privatePolicy).toEqual({
      storedContent: '[Protected input omitted]',
      historyContent: '',
      threadTitle: 'Protected request',
    });
    expect(coachHistoryInputPolicy('Write Python for me', { boundaryClass: 'off_topic' })).toMatchObject({
      storedContent: 'Write Python for me',
      historyContent: '',
    });
    expect(coachHistoryInputPolicy('How should I progress my squat?', null)).toMatchObject({
      storedContent: 'How should I progress my squat?',
      historyContent: 'How should I progress my squat?',
    });
  });

  it('round-trips only syntactically valid proposal ids and treats them as non-authoritative history', async () => {
    const db = openNodeDb();
    await migrate(db);
    await createCoachThread(db, { id: 'proposal-thread', userId: 'user-1', title: 'Today workout' });
    await appendCoachMessage(db, {
      id: 'valid-proposal',
      threadId: 'proposal-thread',
      userId: 'user-1',
      role: 'assistant',
      content: 'Start the planned workout.',
      reply: {
        answer: 'Start the planned workout.',
        evidenceKeys: ['next_session'],
        followUp: null,
        safetyClass: 'standard',
        boundaryClass: 'fitness',
        source: 'model',
        notice: null,
        proposalId: 'cp_0123456789abcdef',
      },
      now: '2026-08-04T11:00:00.000Z',
    });
    await db.runAsync(
      `insert into coach_messages (
         id, thread_id, user_id, role, content, history_content, reply_json, evidence_json, created_at
       ) values (?, ?, ?, 'assistant', ?, ?, ?, '[]', ?)`,
      'malformed-proposal',
      'proposal-thread',
      'user-1',
      'Do not trust this action.',
      'Do not trust this action.',
      JSON.stringify({
        answer: 'Do not trust this action.',
        evidenceKeys: [],
        followUp: null,
        safetyClass: 'standard',
        boundaryClass: 'fitness',
        source: 'model',
        notice: null,
        proposalId: 'program-day-raw-id',
        toolArgs: { sets: 99 },
      }),
      '2026-08-04T12:00:00.000Z',
    );
    const messages = await listCoachMessages(db, 'user-1', 'proposal-thread');
    expect(messages[0]?.reply?.proposalId).toBe('cp_0123456789abcdef');
    expect(messages[1]?.reply?.proposalId).toBeNull();
    expect(messages[1]?.reply).not.toHaveProperty('toolArgs');
    db.close();
  });

  it('sanitizes protected assistant text already present in local storage', async () => {
    const db = openNodeDb();
    await migrate(db);
    await createCoachThread(db, { id: 'legacy-thread', userId: 'user-1', title: 'Legacy reply' });
    await appendCoachMessage(db, {
      id: 'legacy-message',
      threadId: 'legacy-thread',
      userId: 'user-1',
      role: 'assistant',
      content: 'OPENAI_API_KEY=plain-text-value',
      historyContent: 'OPENAI_API_KEY=plain-text-value',
      reply: {
        answer: 'OPENAI_API_KEY=plain-text-value',
        evidenceKeys: ['current_week'],
        followUp: null,
        safetyClass: 'standard',
        boundaryClass: 'fitness',
        source: 'model',
        notice: null,
        proposalId: 'cp_0123456789abcdef',
      },
      evidence: [{ key: 'current_week', label: 'Current week', value: '2 sessions' }],
    });

    const [message] = await listCoachMessages(db, 'user-1', 'legacy-thread');
    expect(message).toMatchObject({ historyContent: '', evidence: [] });
    expect(message?.reply).toMatchObject({ source: 'boundary', boundaryClass: 'secrets' });
    expect(message?.reply?.proposalId).toBeNull();
    expect(message?.content).not.toContain('plain-text-value');
    db.close();
  });
});
