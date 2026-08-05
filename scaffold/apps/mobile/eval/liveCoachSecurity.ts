import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCoachRateLimitResult } from '../../../supabase/functions/_shared/coach';
import { trainedCoachEvalPack } from './coachFixtures';

const supabaseUrl = process.env.ATRIUM_COACH_EVAL_SUPABASE_URL?.trim();
const anonKey = process.env.ATRIUM_COACH_EVAL_ANON_KEY?.trim();
const serviceRoleKey = process.env.ATRIUM_COACH_EVAL_SERVICE_ROLE_KEY?.trim();

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error('The live security gate requires ATRIUM_COACH_EVAL_SUPABASE_URL, ATRIUM_COACH_EVAL_ANON_KEY, and ATRIUM_COACH_EVAL_SERVICE_ROLE_KEY in apps/mobile/.env.coach-eval.');
}

const evalSupabaseUrl = supabaseUrl;
const evalAnonKey = anonKey;
const evalServiceRoleKey = serviceRoleKey;
const endpoint = `${evalSupabaseUrl.replace(/\/$/, '')}/functions/v1/coach-chat`;
const createdUserIds: string[] = [];
let serviceClient: SupabaseClient;

async function createAnonymousSession() {
  const client = createClient(evalSupabaseUrl, evalAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user || !data.session?.access_token) {
    throw new Error(`Could not create a disposable security-gate user: ${error?.message ?? 'no authenticated session returned'}`);
  }
  createdUserIds.push(data.user.id);
  return { client, userId: data.user.id, accessToken: data.session.access_token };
}

function requestBody() {
  return {
    message: 'Should I add weight to my next workout?',
    history: [],
    context: trainedCoachEvalPack.modelContext,
    evidence: trainedCoachEvalPack.evidence,
  };
}

describe.sequential('live AI Coach security gate', () => {
  beforeAll(() => {
    serviceClient = createClient(evalSupabaseUrl, evalServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  afterAll(async () => {
    await Promise.all(createdUserIds.map((userId) => serviceClient.auth.admin.deleteUser(userId)));
  });

  it('rejects missing and invalid bearer tokens before reading the request', async () => {
    const missing = await fetch(endpoint, {
      method: 'POST',
      headers: { apikey: evalAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody()),
    });
    const invalid = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer invalid-coach-session',
        apikey: evalAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody()),
    });
    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
  });

  it('denies table and limiter access to client roles while allowing the service role', async () => {
    const anonymousClient = createClient(evalSupabaseUrl, evalAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const authenticated = await createAnonymousSession();

    const anonymousRead = await anonymousClient.from('coach_request_events').select('*').limit(1);
    const anonymousRpc = await anonymousClient.rpc('consume_coach_rate_limit', { p_user_id: authenticated.userId });
    const authenticatedRead = await authenticated.client.from('coach_request_events').select('*').limit(1);
    const authenticatedRpc = await authenticated.client.rpc('consume_coach_rate_limit', { p_user_id: authenticated.userId });
    const serviceRpc = await serviceClient.rpc('consume_coach_rate_limit', { p_user_id: authenticated.userId });

    expect(anonymousRead.error).not.toBeNull();
    expect(anonymousRpc.error).not.toBeNull();
    expect(authenticatedRead.error).not.toBeNull();
    expect(authenticatedRpc.error).not.toBeNull();
    expect(serviceRpc.error).toBeNull();
    expect(parseCoachRateLimitResult(serviceRpc.data)).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it('serializes concurrent requests, returns Retry-After, and stores only limiter metadata', async () => {
    const session = await createAnonymousSession();
    const attempts = await Promise.all(Array.from({ length: 9 }, () => (
      serviceClient.rpc('consume_coach_rate_limit', { p_user_id: session.userId })
    )));
    expect(attempts.every((attempt) => attempt.error == null)).toBe(true);
    const parsed = attempts.map((attempt) => parseCoachRateLimitResult(attempt.data));
    expect(parsed.every(Boolean)).toBe(true);
    expect(parsed.filter((result) => result?.allowed).length).toBe(8);
    expect(parsed.filter((result) => result && !result.allowed).length).toBe(1);

    const rowsResult = await serviceClient
      .from('coach_request_events')
      .select('*')
      .eq('user_id', session.userId);
    expect(rowsResult.error).toBeNull();
    expect(rowsResult.data).toHaveLength(8);
    for (const row of rowsResult.data ?? []) {
      expect(Object.keys(row).sort()).toEqual(['created_at', 'id', 'user_id']);
      expect(row.user_id).toBe(session.userId);
    }

    const limited = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        apikey: evalAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody()),
    });
    const retryAfter = Number(limited.headers.get('Retry-After'));
    expect(limited.status).toBe(429);
    expect(Number.isInteger(retryAfter) && retryAfter > 0).toBe(true);
    expect(limited.headers.get('Cache-Control')).toBe('no-store');
  });
});
