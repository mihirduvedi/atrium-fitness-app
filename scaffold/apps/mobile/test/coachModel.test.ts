import { describe, expect, it } from 'vitest';
import {
  createCoachModelRequest,
  fetchCoachModelResponse,
  parseCoachModelOutput,
  resolveCoachModelConfig,
} from '../../../supabase/functions/_shared/coachModel';

function environment(values: Record<string, string>) {
  return (name: string) => values[name];
}

const requestInput = {
  systemPrompt: 'Stay grounded.',
  userPayload: { athleteQuestion: 'Should I add weight?' },
  responseFormat: {
    type: 'json_schema' as const,
    name: 'atrium_coach_reply',
    strict: true,
    schema: {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    },
  },
  safetyIdentifier: 'hashed-user-id',
};

describe('Coach model provider', () => {
  it('keeps the OpenAI Responses path backward compatible with a cheaper default', () => {
    const config = resolveCoachModelConfig(environment({ OPENAI_API_KEY: 'server-secret' }));
    expect(config).toMatchObject({
      provider: 'openai',
      model: 'gpt-5.6-luna',
      endpoint: 'https://api.openai.com/v1/responses',
      timeoutMs: 15_000,
      maxOutputTokens: 300,
      reasoningEffort: 'low',
    });
    const request = createCoachModelRequest(config!, requestInput);
    const body = JSON.parse(String(request.init.body));
    expect(body).toMatchObject({
      model: 'gpt-5.6-luna',
      store: false,
      safety_identifier: 'hashed-user-id',
      reasoning: { effort: 'low' },
      text: { format: requestInput.responseFormat },
    });
    expect((request.init.headers as Record<string, string>).Authorization).toBe('Bearer server-secret');
  });

  it('builds a portable Chat Completions request for local Ollama', () => {
    const config = resolveCoachModelConfig(environment({
      COACH_LLM_PROVIDER: 'openai-compatible',
      COACH_LLM_BASE_URL: 'http://host.docker.internal:11434/v1/',
      COACH_LLM_MODEL: 'gpt-oss:20b',
    }));
    expect(config).toMatchObject({
      provider: 'openai-compatible',
      model: 'gpt-oss:20b',
      endpoint: 'http://host.docker.internal:11434/v1/chat/completions',
      apiKey: null,
      timeoutMs: 120_000,
      maxOutputTokens: 300,
      reasoningEffort: null,
    });
    const request = createCoachModelRequest(config!, requestInput);
    const body = JSON.parse(String(request.init.body));
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: requestInput.responseFormat.name,
        strict: true,
        schema: requestInput.responseFormat.schema,
      },
    });
    expect(body).not.toHaveProperty('safety_identifier');
    expect(body).not.toHaveProperty('store');
    expect(body.max_tokens).toBe(300);
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(request.init.headers).not.toHaveProperty('Authorization');
  });

  it('requires HTTPS and a separate provider key for remote compatible APIs', () => {
    expect(resolveCoachModelConfig(environment({
      COACH_LLM_PROVIDER: 'openai-compatible',
      COACH_LLM_BASE_URL: 'http://api.example.com/v1',
      COACH_LLM_MODEL: 'free-model',
      COACH_LLM_API_KEY: 'provider-secret',
    }))).toBeNull();
    expect(resolveCoachModelConfig(environment({
      COACH_LLM_PROVIDER: 'openai-compatible',
      COACH_LLM_BASE_URL: 'https://api.example.com/v1',
      OPENAI_COACH_MODEL: 'must-not-be-reused',
      COACH_LLM_API_KEY: 'provider-secret',
    }))).toBeNull();
    expect(resolveCoachModelConfig(environment({
      COACH_LLM_PROVIDER: 'openai-compatible',
      COACH_LLM_BASE_URL: 'https://api.example.com/v1',
      COACH_LLM_MODEL: 'free-model',
    }))).toBeNull();
    expect(resolveCoachModelConfig(environment({
      COACH_LLM_PROVIDER: 'openai-compatible',
      COACH_LLM_BASE_URL: 'https://api.example.com/v1',
      COACH_LLM_MODEL: 'free-model',
      COACH_LLM_API_KEY: 'provider-secret',
      COACH_LLM_MAX_OUTPUT_TOKENS: '600',
      COACH_LLM_REASONING_EFFORT: 'low',
      OPENAI_API_KEY: 'must-not-be-reused',
    }))).toMatchObject({
      apiKey: 'provider-secret',
      endpoint: 'https://api.example.com/v1/chat/completions',
      maxOutputTokens: 600,
      reasoningEffort: 'low',
    });

    const request = createCoachModelRequest(resolveCoachModelConfig(environment({
      COACH_LLM_PROVIDER: 'openai-compatible',
      COACH_LLM_BASE_URL: 'https://api.groq.com/openai/v1',
      COACH_LLM_MODEL: 'openai/gpt-oss-20b',
      COACH_LLM_API_KEY: 'groq-secret',
      COACH_LLM_MAX_OUTPUT_TOKENS: '600',
      COACH_LLM_REASONING_EFFORT: 'low',
    }))!, requestInput);
    const body = JSON.parse(String(request.init.body));
    expect(body).toMatchObject({
      model: 'openai/gpt-oss-20b',
      max_tokens: 600,
      reasoning_effort: 'low',
    });
  });

  it('normalizes OpenAI and compatible response bodies', () => {
    expect(parseCoachModelOutput('openai', {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{"answer":"OpenAI"}' }] }],
    })).toEqual({ kind: 'text', text: '{"answer":"OpenAI"}' });
    expect(parseCoachModelOutput('openai-compatible', {
      choices: [{ finish_reason: 'stop', message: { content: '{"answer":"Local"}' } }],
    })).toEqual({ kind: 'text', text: '{"answer":"Local"}' });
    expect(parseCoachModelOutput('openai-compatible', {
      choices: [{ finish_reason: 'length', message: { content: '{}' } }],
    })).toEqual({ kind: 'incomplete' });
  });

  it('retries one transient provider failure with a fresh request', async () => {
    const config = resolveCoachModelConfig(environment({
      COACH_LLM_PROVIDER: 'openai-compatible',
      COACH_LLM_BASE_URL: 'https://api.groq.com/openai/v1',
      COACH_LLM_MODEL: 'openai/gpt-oss-20b',
      COACH_LLM_API_KEY: 'groq-secret',
    }))!;
    const signals: (AbortSignal | null | undefined)[] = [];
    const sleeps: number[] = [];
    let call = 0;
    const response = await fetchCoachModelResponse(config, requestInput, {
      fetch: async (_url, init) => {
        signals.push(init?.signal);
        call += 1;
        return call === 1
          ? new Response('', { status: 503, headers: { 'Retry-After': '1' } })
          : new Response('{}', { status: 200 });
      },
      sleep: async (milliseconds) => { sleeps.push(milliseconds); },
    });

    expect(response?.status).toBe(200);
    expect(call).toBe(2);
    expect(sleeps).toEqual([1_000]);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it('does not retry a non-transient provider rejection', async () => {
    const config = resolveCoachModelConfig(environment({
      COACH_LLM_PROVIDER: 'openai-compatible',
      COACH_LLM_BASE_URL: 'https://api.example.com/v1',
      COACH_LLM_MODEL: 'free-model',
      COACH_LLM_API_KEY: 'provider-secret',
    }))!;
    let calls = 0;
    const response = await fetchCoachModelResponse(config, requestInput, {
      fetch: async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: { type: 'invalid_request_error', code: 'invalid_parameter' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      },
      sleep: async () => { throw new Error('sleep should not run'); },
    });

    expect(response?.status).toBe(400);
    expect(calls).toBe(1);
  });

  it('falls back to locally validated JSON mode after strict generation validation fails', async () => {
    const config = resolveCoachModelConfig(environment({
      COACH_LLM_PROVIDER: 'openai-compatible',
      COACH_LLM_BASE_URL: 'https://api.groq.com/openai/v1',
      COACH_LLM_MODEL: 'openai/gpt-oss-20b',
      COACH_LLM_API_KEY: 'groq-secret',
    }))!;
    const responseFormats: unknown[] = [];
    let calls = 0;
    const response = await fetchCoachModelResponse(config, requestInput, {
      fetch: async (_url, init) => {
        responseFormats.push(JSON.parse(String(init?.body)).response_format);
        calls += 1;
        return calls === 1
          ? new Response(JSON.stringify({ error: { type: 'invalid_request_error', code: 'json_validate_failed' } }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            })
          : new Response('{}', { status: 200 });
      },
      sleep: async () => undefined,
    });

    expect(response?.status).toBe(200);
    expect(responseFormats[0]).toMatchObject({ type: 'json_schema' });
    expect(responseFormats[1]).toEqual({ type: 'json_object' });
  });
});
