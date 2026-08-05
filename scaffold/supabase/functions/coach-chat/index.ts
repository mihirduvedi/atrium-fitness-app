import { createClient } from 'npm:@supabase/supabase-js@2.108.1';
import {
  COACH_RESPONSE_FORMAT,
  COACH_SYSTEM_PROMPT,
  boundaryReply,
  classifyCoachBoundary,
  classifyCoachSafety,
  detectProtectedCoachOutput,
  findUnsupportedCoachClaims,
  parseCoachRateLimitResult,
  safetyReply,
  undefinedCoachTermReply,
  validateCoachRequest,
  validateStructuredReply,
} from '../_shared/coach.ts';
import {
  fetchCoachModelResponse,
  parseCoachModelOutput,
  resolveCoachModelConfig,
} from '../_shared/coachModel.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extraHeaders, 'Content-Type': 'application/json' },
  });
}

function modelFailure(error: string, code: string) {
  return json({ error, code }, 502);
}

async function providerFailureCode(response: Response) {
  if (response.status === 400) {
    try {
      const body = await response.clone().json() as { error?: { code?: unknown } };
      if (body.error?.code === 'json_validate_failed') return 'structured_output_failed';
    } catch {
      // Use the stable client-facing category below.
    }
    return 'provider_rejected';
  }
  if (response.status === 401 || response.status === 403) return 'provider_auth_failed';
  if (response.status === 408) return 'provider_timeout';
  if (response.status === 429) return 'provider_rate_limited';
  if (response.status >= 500) return 'provider_unavailable';
  return 'provider_request_failed';
}

async function safetyIdentifier(userId: string) {
  const bytes = new TextEncoder().encode(userId);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const authorization = request.headers.get('Authorization');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!authorization || !supabaseUrl || !supabaseAnonKey) return json({ error: 'Authentication is unavailable.' }, 401);

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData.user) return json({ error: 'A valid Atrium session is required.' }, 401);

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return json({ error: 'Request body must be JSON.' }, 400);
  }
  const input = validateCoachRequest(rawBody);
  if (!input) return json({ error: 'Coach request is invalid or too large.' }, 400);

  const deterministicSafety = safetyReply(classifyCoachSafety(input.message));
  if (deterministicSafety) return json(deterministicSafety);
  const deterministicBoundary = boundaryReply(classifyCoachBoundary(input.message));
  if (deterministicBoundary) return json(deterministicBoundary);
  const undefinedTerm = undefinedCoachTermReply(input.message, input.context, input.evidence);
  if (undefinedTerm) return json(undefinedTerm);

  const modelConfig = resolveCoachModelConfig((name) => Deno.env.get(name));
  if (!modelConfig) return json({ error: 'Live coach is not configured.' }, 503);

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceRoleKey) return json({ error: 'Coach request protection is unavailable.' }, 503);
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: rateData, error: rateError } = await serviceClient.rpc('consume_coach_rate_limit', {
    p_user_id: authData.user.id,
  });
  const rateLimit = rateError ? null : parseCoachRateLimitResult(rateData);
  if (!rateLimit) return json({ error: 'Coach request protection is unavailable.' }, 503);
  if (!rateLimit.allowed) {
    return json(
      { error: 'Coach request limit reached. Try again later.' },
      429,
      { 'Retry-After': String(rateLimit.retryAfterSeconds) },
    );
  }

  const modelInput = {
    systemPrompt: COACH_SYSTEM_PROMPT,
    userPayload: {
      athleteQuestion: input.message,
      recentConversation: input.history,
      context: input.context,
      evidence: input.evidence,
    },
    responseFormat: COACH_RESPONSE_FORMAT,
    safetyIdentifier: await safetyIdentifier(authData.user.id),
  };
  const response = await fetchCoachModelResponse(modelConfig, modelInput);

  if (!response?.ok) {
    const code = response ? await providerFailureCode(response) : 'provider_network';
    return modelFailure('Live coach could not respond.', code);
  }
  let rawModelResponse: unknown;
  try {
    rawModelResponse = await response.json();
  } catch {
    return modelFailure('Live coach returned an invalid response.', 'provider_invalid_json');
  }
  const modelOutput = parseCoachModelOutput(modelConfig.provider, rawModelResponse);
  if (modelOutput.kind === 'incomplete') {
    return modelFailure('Live coach response was incomplete.', 'provider_incomplete');
  }
  if (modelOutput.kind === 'refusal') {
    return json({
      answer: 'I cannot answer that safely. Ask me about your logged training, recovery, or current program instead.',
      evidenceKeys: [],
      followUp: null,
      safetyClass: 'medical',
      boundaryClass: 'fitness',
    });
  }
  if (modelOutput.kind !== 'text') {
    return modelFailure('Live coach returned no usable answer.', `provider_${modelOutput.kind}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(modelOutput.text);
  } catch {
    return modelFailure('Live coach returned an invalid answer.', 'answer_invalid_json');
  }
  const reply = validateStructuredReply(parsed, new Set(input.evidence.map((item) => item.key)));
  if (!reply) {
    return modelFailure('Live coach returned an invalid answer.', 'answer_invalid_shape');
  }
  const unsupportedClaims = findUnsupportedCoachClaims(reply.answer, input.context, input.evidence);
  if (unsupportedClaims.length) {
    const allowedEvidence = new Set(input.evidence.map((item) => item.key));
    return json({
      answer: 'The supplied log does not contain a verified load or progression target for that decision. Keep the programmed range and log completed load and reps before changing it.',
      evidenceKeys: ['next_session', 'recovery', 'current_week'].filter((key) => allowedEvidence.has(key)).slice(0, 3),
      followUp: null,
      safetyClass: 'standard',
      boundaryClass: 'fitness',
    });
  }
  const outputText = `${reply.answer}\n${reply.followUp ?? ''}`;
  const protectedOutput = detectProtectedCoachOutput(outputText);
  if (protectedOutput) return json(boundaryReply(protectedOutput));
  const outputSafety = classifyCoachSafety(outputText);
  if (outputSafety !== 'standard') return json(safetyReply(outputSafety));
  if (reply.safetyClass !== 'standard') return json(safetyReply(reply.safetyClass));
  if (reply.boundaryClass !== 'fitness') return json(boundaryReply(reply.boundaryClass));
  return json(reply);
});
