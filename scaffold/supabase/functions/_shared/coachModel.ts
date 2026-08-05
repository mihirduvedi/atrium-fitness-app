export type CoachModelProvider = 'openai' | 'openai-compatible';

export interface CoachModelConfig {
  provider: CoachModelProvider;
  model: string;
  endpoint: string;
  apiKey: string | null;
  timeoutMs: number;
  maxOutputTokens: number;
  reasoningEffort: 'low' | 'medium' | 'high' | null;
}

export interface CoachModelRequestInput {
  systemPrompt: string;
  userPayload: unknown;
  responseFormat: {
    type: 'json_schema';
    name: string;
    strict: boolean;
    schema: unknown;
  };
  safetyIdentifier: string;
}

export type CoachModelOutput =
  | { kind: 'text'; text: string }
  | { kind: 'refusal' }
  | { kind: 'incomplete' }
  | { kind: 'invalid' };

type ReadEnvironment = (name: string) => string | undefined;

const LOCAL_MODEL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

function optionalEnvironment(readEnvironment: ReadEnvironment, name: string) {
  return readEnvironment(name)?.trim() || null;
}

function parseTimeout(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1_000 && parsed <= 120_000
    ? parsed
    : fallback;
}

function parseMaxOutputTokens(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 2_000
    ? parsed
    : fallback;
}

function parseReasoningEffort(value: string | null) {
  return value === 'low' || value === 'medium' || value === 'high' ? value : null;
}

function compatibleEndpoint(baseUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  const isLocalHttp = parsed.protocol === 'http:' && LOCAL_MODEL_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== 'https:' && !isLocalHttp) return null;
  const normalized = parsed.toString().replace(/\/+$/, '');
  return `${normalized}/chat/completions`;
}

export function resolveCoachModelConfig(readEnvironment: ReadEnvironment): CoachModelConfig | null {
  const providerValue = optionalEnvironment(readEnvironment, 'COACH_LLM_PROVIDER') ?? 'openai';
  if (providerValue !== 'openai' && providerValue !== 'openai-compatible') return null;

  const model = optionalEnvironment(readEnvironment, 'COACH_LLM_MODEL')
    ?? (providerValue === 'openai'
      ? optionalEnvironment(readEnvironment, 'OPENAI_COACH_MODEL') ?? 'gpt-5.6-luna'
      : null);
  if (!model) return null;

  if (providerValue === 'openai') {
    const apiKey = optionalEnvironment(readEnvironment, 'OPENAI_API_KEY');
    if (!apiKey) return null;
    return {
      provider: providerValue,
      model,
      endpoint: 'https://api.openai.com/v1/responses',
      apiKey,
      timeoutMs: parseTimeout(optionalEnvironment(readEnvironment, 'COACH_LLM_TIMEOUT_MS'), 15_000),
      maxOutputTokens: parseMaxOutputTokens(optionalEnvironment(readEnvironment, 'COACH_LLM_MAX_OUTPUT_TOKENS'), 300),
      reasoningEffort: 'low',
    };
  }

  const baseUrl = optionalEnvironment(readEnvironment, 'COACH_LLM_BASE_URL');
  if (!baseUrl) return null;
  const endpoint = compatibleEndpoint(baseUrl);
  if (!endpoint) return null;
  const apiKey = optionalEnvironment(readEnvironment, 'COACH_LLM_API_KEY');
  const endpointHost = new URL(endpoint).hostname;
  if (!LOCAL_MODEL_HOSTS.has(endpointHost) && !apiKey) return null;
  return {
    provider: providerValue,
    model,
    endpoint,
    apiKey,
    timeoutMs: parseTimeout(optionalEnvironment(readEnvironment, 'COACH_LLM_TIMEOUT_MS'), 120_000),
    maxOutputTokens: parseMaxOutputTokens(optionalEnvironment(readEnvironment, 'COACH_LLM_MAX_OUTPUT_TOKENS'), 300),
    reasoningEffort: parseReasoningEffort(optionalEnvironment(readEnvironment, 'COACH_LLM_REASONING_EFFORT')),
  };
}

export function createCoachModelRequest(
  config: CoachModelConfig,
  input: CoachModelRequestInput,
  options: { relaxedCompatibleJson?: boolean } = {},
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  if (config.provider === 'openai') {
    return {
      url: config.endpoint,
      init: {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(config.timeoutMs),
        body: JSON.stringify({
          model: config.model,
          store: false,
          safety_identifier: input.safetyIdentifier,
          max_output_tokens: config.maxOutputTokens,
          reasoning: { effort: 'low' },
          text: {
            verbosity: 'low',
            format: input.responseFormat,
          },
          input: [
            { role: 'system', content: input.systemPrompt },
            { role: 'user', content: JSON.stringify(input.userPayload) },
          ],
        }),
      } satisfies RequestInit,
    };
  }

  return {
    url: config.endpoint,
    init: {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(config.timeoutMs),
      body: JSON.stringify({
        model: config.model,
        stream: false,
        temperature: 0,
        max_tokens: config.maxOutputTokens,
        ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
        response_format: options.relaxedCompatibleJson
          ? { type: 'json_object' }
          : {
              type: 'json_schema',
              json_schema: {
                name: input.responseFormat.name,
                strict: input.responseFormat.strict,
                schema: input.responseFormat.schema,
              },
            },
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: JSON.stringify(input.userPayload) },
        ],
      }),
    } satisfies RequestInit,
  };
}

const RETRYABLE_MODEL_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

async function isStructuredOutputValidationFailure(response: Response) {
  if (response.status !== 400) return false;
  try {
    const body = await response.clone().json() as { error?: { code?: unknown } };
    return body.error?.code === 'json_validate_failed';
  } catch {
    return false;
  }
}

function retryDelayMs(response: Response | null) {
  if (!response) return 300;
  const retryAfter = Number(response.headers.get('Retry-After'));
  return Number.isFinite(retryAfter) && retryAfter >= 0
    ? Math.min(2_000, Math.max(300, Math.ceil(retryAfter * 1_000)))
    : 300;
}

export async function fetchCoachModelResponse(
  config: CoachModelConfig,
  input: CoachModelRequestInput,
  dependencies: {
    fetch?: typeof fetch;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
) {
  const fetchImplementation = dependencies.fetch ?? fetch;
  const sleep = dependencies.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let lastResponse: Response | null = null;
  let relaxedCompatibleJson = false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const request = createCoachModelRequest(config, input, { relaxedCompatibleJson });
    try {
      lastResponse = await fetchImplementation(request.url, request.init);
    } catch {
      lastResponse = null;
    }
    const structuredOutputFailure = lastResponse
      ? await isStructuredOutputValidationFailure(lastResponse)
      : false;
    const shouldRetry = attempt === 0 && (
      !lastResponse
      || RETRYABLE_MODEL_STATUSES.has(lastResponse.status)
      || structuredOutputFailure
    );
    if (!shouldRetry) return lastResponse;
    relaxedCompatibleJson = structuredOutputFailure && config.provider === 'openai-compatible';
    await sleep(retryDelayMs(lastResponse));
  }

  return lastResponse;
}

function parseOpenAIOutput(value: unknown): CoachModelOutput {
  if (!value || typeof value !== 'object') return { kind: 'invalid' };
  const response = value as {
    status?: string;
    output?: { type?: string; content?: { type?: string; text?: string; refusal?: string }[] }[];
  };
  if (response.status === 'incomplete') return { kind: 'incomplete' };
  const message = response.output?.find((item) => item.type === 'message');
  if (message?.content?.some((item) => item.type === 'refusal')) return { kind: 'refusal' };
  const content = message?.content?.find((item) => item.type === 'output_text');
  return content?.text ? { kind: 'text', text: content.text } : { kind: 'invalid' };
}

function chatContentText(content: unknown) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const text = content
    .map((item) => item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string'
      ? (item as { text: string }).text
      : '')
    .join('')
    .trim();
  return text || null;
}

function parseCompatibleOutput(value: unknown): CoachModelOutput {
  if (!value || typeof value !== 'object') return { kind: 'invalid' };
  const response = value as {
    choices?: {
      finish_reason?: string;
      message?: { content?: unknown; refusal?: unknown };
    }[];
  };
  const choice = response.choices?.[0];
  if (!choice) return { kind: 'invalid' };
  if (choice.finish_reason === 'length') return { kind: 'incomplete' };
  if (typeof choice.message?.refusal === 'string' && choice.message.refusal.trim()) return { kind: 'refusal' };
  const text = chatContentText(choice.message?.content);
  return text ? { kind: 'text', text } : { kind: 'invalid' };
}

export function parseCoachModelOutput(provider: CoachModelProvider, value: unknown): CoachModelOutput {
  return provider === 'openai' ? parseOpenAIOutput(value) : parseCompatibleOutput(value);
}
