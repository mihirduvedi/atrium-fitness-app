# AI Coach setup

Atrium's current AI Coach slice is grounded chat plus an explicitly confirmed, validated one-workout proposal. The mobile app builds a structured context pack from the athlete's local profile, program, completed workouts, PRs, recovery data, and a bounded set of device-constructed options. An authenticated Supabase Edge Function sends that minimized context to a configured model provider and returns a schema-validated answer with evidence keys that map back to facts the app already computed.

User-visible conversation threads remain only in the app's local SQLite database. Threads do not enter Atrium's generic sync queue and can be permanently deleted from the Coach screen. The Coach does not rewrite Programs, diagnose injuries, or prescribe treatment. It may select one exact prevalidated next-workout option, but the device performs no write until the athlete reviews the card and presses **Apply & start workout**.

## Runtime boundary

- `apps/mobile/src/coach/context.ts` computes facts and model context from local SQLite.
- `apps/mobile/src/coach/proposals.ts` constructs opaque proposal options, applies only engine-valid one-workout changes, and revalidates/idempotently starts the resulting workout draft.
- `apps/mobile/src/coach/chat.ts` owns the mobile response contract, deterministic safety routing, evidence filtering, and on-device fallback.
- `apps/mobile/src/coach/history.ts` owns user-scoped, device-local thread storage and the protected-input retention policy.
- `apps/mobile/src/coach/service.ts` invokes `coach-chat` only when Supabase is configured and reachable.
- `apps/mobile/eval/` defines the fictional regression cases, shared scorer, and opt-in live endpoint runner.
- `supabase/functions/coach-chat/index.ts` authenticates the Atrium user and owns the server-side model call.
- `supabase/functions/_shared/coachModel.ts` keeps OpenAI Responses and OpenAI-compatible Chat Completions providers behind one validated contract.
- `supabase/functions/_shared/coach.ts` validates input size and proposal options, repeats the safety gate server-side, defines prompt `2026-08-05.7` and schema `2`, and validates the structured response against evidence and proposal allowlists.
- `supabase/migrations/0004_coach_security.sql` installs the service-role-only per-user rate limiter. It stores only user IDs and request timestamps, never messages, replies, or training values.

No model-provider credential belongs in the Expo app. OpenAI requests read `OPENAI_API_KEY` from Supabase secrets and send `store: false`. Compatible providers use a separate `COACH_LLM_API_KEY`; the function never forwards an OpenAI key to another host. Every production provider needs its own retention, training-use, subprocessors, and privacy review.

## One-workout proposal boundary

The current proposal set contains at most three deterministic options: start the next planned workout unchanged, or remove the final one or two non-warm-up back-off sets from the first eligible movement while leaving at least one. A reduction preserves warm-ups, the top set, load, reps, exercise identity, untargeted movements, and every later Program day.

The provider receives only an opaque `cp_` ID, `keep_plan` or `reduce_volume`, and a bounded summary for each option. It does not receive the local target slot ID or arbitrary mutation arguments. The server re-sanitizes the options, filters them to the athlete's immediate question, and accepts only an exact returned ID from that filtered set. The mobile client repeats the same output allowlist before showing a card.

At Apply time, `startCoachProposalWorkout` rechecks active-workout state, current readiness, the next Program day, a fresh engine preview, the proposal ID/fingerprint, and engine validation. Red readiness or a changed plan returns stale. A different active workout blocks the proposal; the same already-applied proposal resumes its existing workout. Apply requests are serialized per user so duplicate or competing proposal IDs create at most one live workout and one local draft. The Program itself is not rewritten.

## Run locally with Ollama

Ollama provides a zero-per-token development path. Install Ollama, then start its local server and download the selected model once:

```bash
ollama serve
ollama pull llama3.2
```

Copy the checked-in local profile to its Git-ignored runtime file:

```bash
cp supabase/coach-local.env.example supabase/.env.coach-local
```

The profile contains:

```dotenv
COACH_LLM_PROVIDER=openai-compatible
COACH_LLM_BASE_URL=http://host.docker.internal:11434/v1
COACH_LLM_MODEL=llama3.2:latest
COACH_LLM_TIMEOUT_MS=30000
COACH_LLM_MAX_OUTPUT_TOKENS=300
```

`host.docker.internal` lets the Edge Function container reach Ollama on the Mac. The server accepts unencrypted HTTP only for local loopback and Docker-host names; remote compatible providers must use HTTPS and a separate key.

Apply migrations, then run the function with the local Supabase stack:

```bash
npx supabase start
npx supabase db reset
npx supabase functions serve coach-chat --env-file supabase/.env.coach-local --no-verify-jwt
```

In a third terminal, copy `apps/mobile/coach-eval-local.env.example` to the ignored `apps/mobile/.env.coach-eval-local`, fill in the local Supabase values printed by `npx supabase status -o env`, and run:

```bash
npm run coach:smoke:local
```

The smoke command checks one real model-routed grounding case plus three deterministic safety/boundary cases. It refuses to start below 30% free memory, aborts below 20%, reports the lowest observed headroom, and unloads `llama3.2` when it finishes.

The first local response can be slower while Ollama loads the model. On a 24 GB development Mac that is also running Docker and normal desktop apps, use `llama3.2` only for endpoint, authentication, and schema smoke tests. In the observed setup, a short guarded smoke stayed above the 20% cutoff, while `qwen3:4b-instruct`, an 8B model, and the 20B model all caused unsafe memory pressure. Do not run those larger models alongside this stack on that machine.

Check headroom with `memory_pressure -Q` before and during local inference. Stop the model with `ollama stop llama3.2:latest` if free memory approaches 20%. The 3B model did not pass Atrium's harder grounding checks, so use a stronger hosted model for the release-quality gate and record that provider/model in the evaluation metadata.

## Configure an API provider

OpenAI uses the Responses API and defaults to the cost-sensitive `gpt-5.6-luna` model:

```dotenv
COACH_LLM_PROVIDER=openai
OPENAI_API_KEY=
COACH_LLM_MODEL=gpt-5.6-luna
COACH_LLM_TIMEOUT_MS=15000
```

An HTTPS provider implementing OpenAI-compatible Chat Completions and JSON-schema Structured Outputs can use:

```dotenv
COACH_LLM_PROVIDER=openai-compatible
COACH_LLM_BASE_URL=https://provider.example/v1
COACH_LLM_API_KEY=
COACH_LLM_MODEL=provider-model-id
COACH_LLM_TIMEOUT_MS=15000
COACH_LLM_MAX_OUTPUT_TOKENS=300
```

Free API tiers are suitable only for fictional evaluations until their data-use and retention terms pass production review. Model availability and limits can change, so record the exact provider and model with every gate run.

### Current free online evaluation options

The compatible adapter can use Groq's free developer plan without another code change. Groq currently supports strict Structured Outputs for `openai/gpt-oss-20b`:

```dotenv
COACH_LLM_PROVIDER=openai-compatible
COACH_LLM_BASE_URL=https://api.groq.com/openai/v1
COACH_LLM_API_KEY=replace-with-groq-key
COACH_LLM_MODEL=openai/gpt-oss-20b
COACH_LLM_TIMEOUT_MS=30000
COACH_LLM_MAX_OUTPUT_TOKENS=600
COACH_LLM_REASONING_EFFORT=low
```

As of August 5, 2026, Groq's base free limits for this model are 30 requests/minute, 1,000 requests/day, 8,000 tokens/minute, and 200,000 tokens/day. The Groq evaluation profile conservatively spaces model-routed cases 30 seconds apart—about two calls per minute—because each request also carries the grounding context and reasoning tokens. Check the limits shown for your own organization before each run because free-tier limits can change.

The Groq adapter first requests strict JSON-schema output. Groq can occasionally reject an otherwise valid prompt with `json_validate_failed`; only for that error, Atrium retries once in JSON-object mode and then applies the same local schema, enum, evidence-key, safety, and grounding validation before returning a reply. Other client errors are not retried. Unsupported measured claims, changed units, and unverified repeated rep schemes are replaced by a conservative programmed-range response. Definition questions for terms absent from the supplied context are answered deterministically instead of inviting the model to invent product behavior.

To configure the hosted gate:

1. Create a key at [Groq API Keys](https://console.groq.com/keys).
2. Copy `supabase/coach-groq.env.example` to the ignored `supabase/.env.coach-groq` and replace only `COACH_LLM_API_KEY`.
3. Copy `apps/mobile/coach-eval-groq.env.example` to the ignored `apps/mobile/.env.coach-eval-groq` and fill in the staging or local Supabase public/secret values. The Groq key never belongs in this evaluator file.
4. In Groq Data Controls, enable Zero Data Retention before any non-fictional or user-derived evaluation. Until production privacy review is complete, run only the repository's fictional fixtures.
5. Serve the function and run the gate:

```bash
npm run coach:groq:check
npx supabase functions serve coach-chat --env-file supabase/.env.coach-groq --no-verify-jwt
npm run coach:gate:groq
```

The preflight validates the endpoint, exact model, pacing, output budget, reasoning level, and presence of a credential without printing the credential.

Groq inference requests are not retained by default, but inputs and outputs may otherwise be logged for up to 30 days for reliability or abuse investigation. Groq documents Zero Data Retention as available through Data Controls. This operational setting is separate from Atrium's code and must be checked before production use.

OpenRouter also exposes free models through an OpenAI-compatible endpoint:

```dotenv
COACH_LLM_PROVIDER=openai-compatible
COACH_LLM_BASE_URL=https://openrouter.ai/api/v1
COACH_LLM_API_KEY=replace-with-openrouter-key
COACH_LLM_MODEL=replace-with-a-pinned-structured-output-model-free
COACH_LLM_TIMEOUT_MS=30000
```

Pin an exact OpenRouter `:free` model that advertises `structured_outputs`; do not use a randomly routed free model for a comparable release gate. Free limits, model availability, and provider data policies can change. Google Gemini also has a free API tier, but its free-tier terms currently permit submitted content to be used to improve Google's products, so it is restricted to fictional fixtures unless that policy changes and receives privacy approval.

## Configure a linked project

Keep real values in an ignored environment file and upload them without putting the key directly in shell history:

```bash
npx supabase secrets set --env-file supabase/.env
npx supabase functions deploy coach-chat
```

The function requires a valid Supabase bearer token even though Atrium permits anonymous authenticated accounts. Requests are capped at 600 characters, six prior messages, 30,000 characters of context, and three sanitized proposal options. Model output is configurable per provider; the Groq evaluation profile uses a 600-token completion ceiling for its short structured reply. Live model calls are limited to eight per minute and 100 per rolling 24 hours per authenticated user. Deterministic safety and boundary replies do not consume that allowance. OpenAI requests include a SHA-256 hash of the Supabase user ID as its privacy-preserving `safety_identifier`; compatible providers do not receive that identifier.

## Run evaluations

The normal test suite runs 35 grounding, insufficiency, safety, privacy, scope, secret-extraction, multilingual, false-positive, proposal-selection, and adversarial cases against the deterministic fallback. Focused proposal tests separately exercise construction, allowlisting, stale/readiness behavior, active-workout handling, engine preservation, and idempotent one-draft creation. The opt-in staging gate sends the same fictional answer cases through the authenticated Edge Function and verifies auth, database permissions, concurrent rate limiting, metadata minimization, and `Retry-After` behavior without exposing a provider key to the app. See [AI_COACH_EVALS.md](AI_COACH_EVALS.md) for setup, commands, and the exact verification boundary.

## Safety and grounding contract

- Pain, medical-treatment, extreme-restriction, and urgent phrases are routed deterministically before a model call on both mobile and server.
- Secret extraction, private-data requests, prompt injection, and non-fitness questions are also routed before the model. Unknown topics fail closed unless they contain an explicit fitness signal or a small supported Coach shorthand.
- The outbound context omits account contact information, raw database IDs, and exact workout timestamps. The server rebuilds it from an allowlist and redacts hostile or protected custom labels.
- Model output uses prompt `2026-08-05.7` and strict schema `2` with exactly `answer`, `evidenceKeys`, `followUp`, `safetyClass`, `boundaryClass`, and nullable `proposalId`; extra fields invalidate the response.
- Replies target one or two decision-first sentences, omit filler and repeated context, and use a follow-up only when it materially changes the training decision. Server and client cap answers at 600 characters and follow-ups at 140 characters.
- Answer and follow-up text are scanned again for protected values and safety language. Non-fitness and non-standard responses are replaced with fixed Atrium-owned copy rather than displayed verbatim.
- Unknown or invented evidence keys and proposal IDs are discarded before display. Safety and boundary replies always carry no proposal.
- Protected user inputs are not stored verbatim in local thread history, and no deterministically routed request is replayed to the model in a later turn.
- The model has no arbitrary mutation tools. It may select one exact device-constructed option but cannot supply arguments, bypass local validation, or claim it changed a plan.
- Missing backend configuration, authentication, network access, or a valid model response falls back to on-device guidance tied to the same context and prevalidated option set. The fallback returns no action under red readiness.

These are layered safeguards, not a guarantee that every unsafe or irrelevant phrasing will be detected. Before production, run the live suite, obtain qualified fitness-domain review, complete privacy/legal and retention review for health-adjacent data, add an issue-reporting path, and threat-model the deployed function and database policies. Keep any broader multi-workout or Program mutation outside this narrow action until it receives its own deterministic validation, confirmation, and tool-level evaluation. See [AI_COACH_PRIVACY.md](AI_COACH_PRIVACY.md) for the data boundary and remaining risks.

Official references:

- [Responses API and current model guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Safety best practices](https://developers.openai.com/api/docs/guides/safety-best-practices)
- [Working with evals](https://developers.openai.com/api/docs/guides/evals)
- [API data controls](https://developers.openai.com/api/docs/guides/your-data)
- [Run gpt-oss locally with Ollama](https://developers.openai.com/cookbook/articles/gpt-oss/run-locally-ollama)
- [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
- [Groq OpenAI compatibility](https://console.groq.com/docs/openai)
- [Groq Structured Outputs](https://console.groq.com/docs/structured-outputs)
- [Groq free-plan rate limits](https://console.groq.com/docs/rate-limits)
- [Groq inference data controls](https://console.groq.com/docs/your-data)
- [OpenRouter free-model limits](https://openrouter.ai/docs/faq)
- [OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
- [Gemini API pricing and free-tier data use](https://ai.google.dev/gemini-api/docs/pricing)
