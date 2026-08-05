import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCoachReply } from '../src/coach/chat';
import { coachEvalCases } from './coachFixtures';
import { evaluateCoachReply, formatCoachEvalFailures } from './coachEvaluator';
import {
  COACH_PROMPT_VERSION,
  COACH_SCHEMA_VERSION,
} from '../../../supabase/functions/_shared/coach';

const supabaseUrl = process.env.ATRIUM_COACH_EVAL_SUPABASE_URL?.trim();
const anonKey = process.env.ATRIUM_COACH_EVAL_ANON_KEY?.trim();
const declaredModel = process.env.ATRIUM_COACH_EVAL_MODEL?.trim();
const declaredProvider = process.env.ATRIUM_COACH_EVAL_PROVIDER?.trim() || 'unspecified';
const configuredTokens = [
  ...(process.env.ATRIUM_COACH_EVAL_TOKENS?.split(',') ?? []),
  process.env.ATRIUM_COACH_EVAL_TOKEN ?? '',
].map((token) => token.trim()).filter((token, index, all) => token && all.indexOf(token) === index);
const showAnswers = process.env.ATRIUM_COACH_EVAL_SHOW_ANSWERS === '1';
const configuredTimeoutMs = Number(process.env.ATRIUM_COACH_EVAL_TIMEOUT_MS);
const requestTimeoutMs = Number.isInteger(configuredTimeoutMs) && configuredTimeoutMs >= 5_000 && configuredTimeoutMs <= 120_000
  ? configuredTimeoutMs
  : 30_000;
const configuredMinIntervalMs = Number(process.env.ATRIUM_COACH_EVAL_MIN_INTERVAL_MS);
const modelRequestMinIntervalMs = Number.isInteger(configuredMinIntervalMs) && configuredMinIntervalMs >= 0 && configuredMinIntervalMs <= 60_000
  ? configuredMinIntervalMs
  : 0;
const modelRequestLimitPerUser = 8;
let accessToken: string;
let configuredTokenIndex = 0;
let modelRequestsForCurrentUser = 0;
let lastModelRequestAt = 0;
let passedCases = 0;
const latencies: number[] = [];

if (!supabaseUrl || !anonKey || !declaredModel) {
  throw new Error('Set ATRIUM_COACH_EVAL_SUPABASE_URL, ATRIUM_COACH_EVAL_ANON_KEY, and ATRIUM_COACH_EVAL_MODEL in apps/mobile/.env.coach-eval.');
}

const evalSupabaseUrl = supabaseUrl;
const evalAnonKey = anonKey;
const evalDeclaredModel = declaredModel;
const evalDeclaredProvider = declaredProvider;
const endpoint = `${evalSupabaseUrl.replace(/\/$/, '')}/functions/v1/coach-chat`;

function expectsModelCall(evalCase: (typeof coachEvalCases)[number]) {
  return evalCase.expectsModelCall !== false
    && evalCase.expectedSafetyClass === 'standard'
    && evalCase.expectedBoundaryClass === 'fitness';
}

async function createDisposableAccessToken() {
  const client = createClient(evalSupabaseUrl, evalAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.session?.access_token) {
    throw new Error(`Could not create a disposable evaluation session: ${error?.message ?? 'no access token returned'}`);
  }
  return data.session.access_token;
}

async function rotateAccessToken() {
  if (configuredTokens.length) {
    const next = configuredTokens[configuredTokenIndex];
    if (!next) {
      throw new Error('The expanded suite needs another authenticated user after eight live model calls. Add a comma-separated token to ATRIUM_COACH_EVAL_TOKENS or omit configured tokens so the runner can rotate disposable anonymous users.');
    }
    configuredTokenIndex += 1;
    accessToken = next;
  } else {
    accessToken = await createDisposableAccessToken();
  }
  modelRequestsForCurrentUser = 0;
}

async function paceModelRequest() {
  const waitMs = lastModelRequestAt + modelRequestMinIntervalMs - Date.now();
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastModelRequestAt = Date.now();
}

describe.sequential('live AI Coach evaluation', () => {
  beforeAll(async () => {
    await rotateAccessToken();
    console.info(`coach-eval-config\tprovider=${evalDeclaredProvider}\tmodel=${evalDeclaredModel}\tprompt=${COACH_PROMPT_VERSION}\tschema=${COACH_SCHEMA_VERSION}\tcases=${coachEvalCases.length}`);
  });

  afterAll(() => {
    const sorted = [...latencies].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    console.info(`coach-eval-summary\tpassed=${passedCases}/${coachEvalCases.length}\tmedian=${median}ms\thuman-review=required`);
  });

  it.each(coachEvalCases)('$id', async (evalCase) => {
    if (expectsModelCall(evalCase)) {
      if (modelRequestsForCurrentUser >= modelRequestLimitPerUser) await rotateAccessToken();
      await paceModelRequest();
      modelRequestsForCurrentUser += 1;
    }
    const startedAt = Date.now();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: evalAnonKey,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(requestTimeoutMs),
      body: JSON.stringify({
        message: evalCase.message,
        history: evalCase.history ?? [],
        context: evalCase.pack.modelContext,
        evidence: evalCase.pack.evidence,
      }),
    });
    const body = await response.text();
    expect(response.ok, `HTTP ${response.status}: ${body.slice(0, 300)}`).toBe(true);

    let rawReply: unknown;
    expect(() => {
      rawReply = JSON.parse(body);
    }, 'response must be JSON').not.toThrow();
    const reply = parseCoachReply(rawReply, evalCase.pack);
    expect(reply, 'response must satisfy the Coach reply contract').not.toBeNull();
    if (!reply) return;

    const result = evaluateCoachReply(evalCase, reply, 'live');
    const latency = Date.now() - startedAt;
    latencies.push(latency);
    if (result.passed) passedCases += 1;
    console.info(`${evalCase.id}\t${latency}ms\t${reply.source}\t${reply.evidenceKeys.join(',') || 'no-evidence'}`);
    if (showAnswers) console.info(`  ${reply.answer.replace(/\s+/g, ' ').trim()}`);
    expect(result.passed, formatCoachEvalFailures(result)).toBe(true);
  }, modelRequestMinIntervalMs + requestTimeoutMs + 5_000);
});
