# AI Coach setup

Atrium's current AI Coach slice is grounded chat plus an explicitly confirmed, validated one-workout proposal. The mobile app builds a structured context pack from the athlete's local profile, program, completed workouts, PRs, recovery data, deterministic adaptation signal, and a bounded set of device-constructed options. An authenticated Supabase Edge Function sends a minimized view to a configured model provider and returns a schema-validated answer with evidence keys that map back to facts the app already computed.

User-visible conversation threads remain only in the app's local SQLite database. Threads do not enter Atrium's generic sync queue and can be permanently deleted from the Coach screen. The Coach does not rewrite Programs, diagnose injuries, or prescribe treatment. It may select one exact prevalidated next-workout option, but the device performs no write until the athlete reviews the card and presses **Apply & start workout**.

## Runtime boundary

- `apps/mobile/src/coach/context.ts` computes facts and model context from local SQLite.
- `apps/mobile/src/coach/adaptation.ts` derives a deload signal from completed active-Program history, readiness on health/check-in-backed days, the upcoming week, and completed proposal-marked deloads.
- `apps/mobile/src/coach/proposals.ts` constructs opaque proposal options, applies only engine-valid one-workout changes, and revalidates/idempotently starts the resulting workout draft.
- `apps/mobile/src/db/queries.ts` rebuilds and persists the final workout, bounded side-table intent plus exact engine base/resume snapshot for newly applied deloads, normal engine slot-state advances, sync mutations, and draft inside one transaction; it validates cross-device active-deload reconstruction and excludes marked workouts from engine history.
- `apps/mobile/src/coach/chat.ts` owns the mobile response contract, deterministic safety routing, evidence filtering, and on-device fallback.
- `apps/mobile/src/coach/history.ts` owns user-scoped, device-local thread storage and the protected-input retention policy.
- `apps/mobile/src/coach/service.ts` invokes `coach-chat` when Supabase is configured and uses the deterministic fallback if the backend is unreachable.
- `apps/mobile/eval/` defines the fictional regression cases, shared scorer, and opt-in live endpoint runner.
- `supabase/functions/coach-chat/index.ts` authenticates the Atrium user and owns the server-side model call.
- `supabase/functions/_shared/coachModel.ts` keeps OpenAI Responses and OpenAI-compatible Chat Completions providers behind one validated contract.
- `supabase/functions/_shared/coach.ts` validates input size, adaptation context, and proposal options, repeats the safety gate server-side, defines the locally expected prompt `2026-08-10.8` and schema `2`, and validates the structured response against evidence and proposal allowlists. These constants do not attest a deployed function's version.
- `supabase/migrations/0004_coach_security.sql` installs the service-role-only per-user rate limiter. It stores a generated event ID, the authenticated user ID, and request timestamp, never messages, replies, or training values.
- `supabase/migrations/0005_workout_training_intent.sql` adds the RLS-owned, synced `workout_training_intents` side table. A live row (`deleted_at is null`) means `coach_deload`; no live row means normal training, though a synced tombstone can remain. Newly applied rows carry a bounded engine base/resume snapshot in `plan_json`, while the nullable field preserves early schema-v12 development markers that have no reconstructable snapshot. `workouts` keeps its schema-v11 wire shape.
- `supabase/migrations/0006_sync_pull_safety.sql` adds RLS-preserving database-time/keyset pull RPCs, an atomic workout+intent upsert, INSERT/UPDATE server timestamps for every synced table, and composite pull indexes.

No model-provider credential belongs in the Expo app. OpenAI requests read `OPENAI_API_KEY` from Supabase secrets and send `store: false`. Compatible providers use a separate `COACH_LLM_API_KEY`; the function never forwards an OpenAI key to another host. Every production provider needs its own retention, training-use, subprocessors, and privacy review.

## One-workout proposal boundary

The current proposal set contains at most three deterministic options: start the next planned workout unchanged, remove the final one or two non-warm-up back-off sets from the first eligible movement while leaving at least one, or apply an engine-triggered one-session deload. When deload is eligible, only one smaller reduction is retained so the option set remains bounded.

The deload signal uses completed working-set history attached to the current active Program, readiness only on dates with health or subjective check-in input in the device-calendar seven-day window, and the next Program week. Two distinct lifts meeting their current-week stall criteria, at least three recorded red-readiness days, or scheduled week 7 can trigger it. A fallback score stored at workout start is not counted as an observed day, and dates with no health sample or subjective check-in are not synthesized. A completed proposal-marked deload with completed working work cools acute triggers for seven days and prevents another scheduled week-7 deload in the same block.

The provider receives only minimized adaptation facts plus an opaque `cp_` ID, a bounded kind (`keep_plan`, `reduce_volume`, or `deload_session`), and a bounded summary for each available option. It does not receive raw set history, adaptation-readiness dates or the adaptation's daily-state sequence, local database IDs, target slot IDs, or arbitrary mutation arguments; summarized recent workouts and PR signals still include calendar dates. The server re-sanitizes the adaptation object, accepts only the fixed next-workout `-40%` volume / `-10%` intensity / drop-top-sets prescription, filters options to the athlete's immediate question, and accepts only an exact returned ID from that filtered set. The mobile client repeats the same output allowlist before showing a card.

A deload uses the deterministic engine to target about 40% fewer working sets, plate-round loads about 10% lower, and remove top sets while retaining at least one working set for each movement that originally had working work. It preserves exercise/slot identity, rest periods, and the unmodified plan's next progression state. The persistent Program structure and future schedule remain unchanged.

At Apply time, `startCoachProposalWorkout` regenerates the adaptation signal and plan, then rechecks active-workout state, active Program and exact next day/week, current readiness, proposal ID/fingerprint, current deload trigger, and engine validation. Red readiness, a disappeared signal, or a changed plan returns stale. A different active workout blocks the proposal; the same already-applied proposal resumes its existing workout. Apply requests are serialized per user. The final plan is rebuilt inside one SQLite transaction, where the workout row, any normal engine-authored slot-state advances, their sync mutations, and the local draft all commit or all roll back. This normal progression persistence is separate from the deload transformation and does not rewrite the Program.

A started deload persists one `workout_training_intents` row with intent
`coach_deload` plus a versioned `plan_json` containing the exact engine base and
resume plans: Program-day/slot/exercise references, session week/readiness,
engine-authored per-slot progression state, sets, rep targets, rest,
plate-rounded loads, and deterministic engine notes/kind. The opaque proposal
ID is removed before sync, and the snapshot contains no workout/event
timestamps, chat, or model output. The row still carries `updated_at` and
optional `deleted_at` sync/tombstone metadata. Workout, RLS-owned
intent/snapshot, normal engine state, sync mutations, and draft share the same
Apply transaction and roll back together.
For a newly applied deload, the local mutation queue publishes workout →
intent/snapshot → sets in causal order and never splits the first two across
its 50-row batch boundary. Migration `0006` publishes that recognized pair in
one idempotent PostgreSQL transaction. Converted early-v12 markers can instead
use ordinary single-row upserts. The migration
server-stamps every synced INSERT/UPDATE, and reads complete 500-row keyset pages
under a database-time barrier. Ordinary pulls replay a five-minute overlap; a
cursor ahead of database time performs a full historical backfill. The device
rewinds its legacy shared cursor once when adopting this contract. A failed page
leaves the cursor unchanged, only an unpushed local mutation wins, and a future
device clock cannot permanently reject a server edit or tombstone.

The snapshot is read only to reconstruct an already-active deload whose local
draft is missing, such as after a cross-device pull. The client bounds its
shape, recomputes the exact deload from the base plan, and requires current
Program day/slot/exercise/rule/rest/state equality. It fails closed when a
snapshot is missing—including an early schema-v12 marker converted with
`plan_json = null`—or malformed, tampered, or stale. The Workout screen then blocks
set logging and offers **Sync & retry**, explicit discard, and return to Today;
Today does not regenerate or auto-discard a synced active Coach workout whose
local draft is missing. Completed sets remain in
history and Progress analytics, while progression and stall analysis exclude
them so reduced deload work cannot support a false normal load increase.

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

The smoke command checks a small mix of real model-routed grounding and deterministic safety/boundary fixtures. It refuses to start below 30% free memory, aborts below 20%, reports the lowest observed headroom, and unloads `llama3.2` when it finishes.

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
npx supabase db push
npx supabase secrets set --env-file supabase/.env
npx supabase functions deploy coach-chat
```

Run `db push` first so migrations `0005_workout_training_intent.sql` and
`0006_sync_pull_safety.sql` are present before a schema-v12 client queries the
intent, `plan_json` snapshot, or sync RPCs. Migration `0005`
does not alter `workouts`, so schema-v11 clients continue syncing their known
table shape and ignore the new table. Keep production deload creation off until
a server- or store-enforced minimum supported client version excludes schema-v11
syncing clients. That enforcement is not implemented yet. The only production
opt-in syntax is `EXPO_PUBLIC_ATRIUM_ADAPTIVE_DELOAD_ENABLED=1`; leave it unset
until the minimum-version gate exists and is active. A legacy client cannot
interpret the side marker and could otherwise reuse pulled deload sets as
normal progression evidence.

The function requires a valid Supabase bearer token even though Atrium permits anonymous authenticated accounts. Requests are capped at 600 characters, six prior messages, 30,000 characters of context, and three sanitized proposal options. Model output is configurable per provider; the Groq evaluation profile uses a 600-token completion ceiling for its short structured reply. Live model calls are limited to eight per minute and 100 per rolling 24 hours per authenticated user. Deterministic safety and boundary replies do not consume that allowance. OpenAI requests include a SHA-256 hash of the Supabase user ID as its privacy-preserving `safety_identifier`; compatible providers do not receive that identifier.

## Run evaluations

The normal test suite runs checked-in fictional grounding, insufficiency, safety, privacy, scope, secret-extraction, multilingual, false-positive, adaptation, deload-selection, and adversarial cases against the deterministic fallback. Focused adaptation and proposal tests separately exercise active-Program history, health/check-in-backed readiness and week-7 triggers, cooldown, construction, allowlisting, stale/readiness behavior, active-workout handling, engine preservation, atomic persistence, and rollback. The opt-in staging gate sends the fictional answer cases through the authenticated Edge Function and verifies auth, database permissions, concurrent rate limiting, metadata minimization, and `Retry-After` behavior without exposing a provider key to the app. See [AI_COACH_EVALS.md](AI_COACH_EVALS.md) for setup, commands, and the exact verification boundary.

## Safety and grounding contract

- Pain, medical-treatment, extreme-restriction, and urgent phrases are routed deterministically before a model call on both mobile and server.
- Secret extraction, private-data requests, prompt injection, and non-fitness questions are also routed before the model. Unknown topics fail closed unless they contain an explicit fitness signal or a small supported Coach shorthand.
- The outbound context omits account contact information, raw database IDs, and exact workout timestamps. The server rebuilds it from an allowlist and redacts hostile or protected custom labels.
- The checked-in function expects prompt `2026-08-10.8` and strict schema `2` with exactly `answer`, `evidenceKeys`, `followUp`, `safetyClass`, `boundaryClass`, and nullable `proposalId`; extra fields invalidate the response. Evaluator output repeats these local expected versions and does not attest a deployed Edge Function.
- Replies target one or two decision-first sentences, omit filler and repeated context, and use a follow-up only when it materially changes the training decision. Server and client cap answers at 600 characters and follow-ups at 140 characters.
- Answer and follow-up text are scanned again for protected values and safety language. Non-fitness and non-standard responses are replaced with fixed Atrium-owned copy rather than displayed verbatim.
- Unknown or invented evidence keys and proposal IDs are discarded before display. Safety and boundary replies always carry no proposal.
- Protected user inputs are not stored verbatim in local thread history, and no deterministically routed request is replayed to the model in a later turn.
- The model has no arbitrary mutation tools. It may select one exact device-constructed option but cannot supply arguments, bypass local validation, or claim it changed a plan.
- Missing backend configuration, authentication, network access, or a valid model response falls back to on-device guidance tied to the same context and prevalidated option set. The fallback can select the supplied deload for an explicit deload request, current fatigue decision, or clear next-workout question, but returns no action under red readiness and cannot invent an option.

These are layered safeguards, not a guarantee that every unsafe or irrelevant phrasing will be detected. Before production, run the live suite, obtain qualified fitness-domain review, complete privacy/legal and retention review for health-adjacent data, add an issue-reporting path, and threat-model the deployed function and database policies. Keep any broader multi-workout or Program mutation outside this narrow action until it receives its own deterministic validation, confirmation, and tool-level evaluation. See [AI_COACH_PRIVACY.md](AI_COACH_PRIVACY.md) for the data boundary and remaining risks.

## Current verification boundary

The adaptive-deload implementation and deterministic regression coverage are
checked in, but the Edge Function corresponding to the locally expected prompt
`2026-08-10.8` and schema `2` has not yet been attested in staging or
production, and migrations `0005_workout_training_intent.sql` and
`0006_sync_pull_safety.sql` have not yet been applied there. The
required server/store minimum-version enforcement is not implemented, so
`EXPO_PUBLIC_ATRIUM_ADAPTIVE_DELOAD_ENABLED=1` must not be used in production.
The repository's existing proposal screenshots cover the earlier
unchanged/volume-reduction path. A prior local iPhone 17 UI/fallback pass
covered the week-7 review through Applied/Resume before the synced side-table
revision. Current native evidence proves only the schema-v12 SQLite migration.
Curated deload screenshots and a full current integrated native re-QA pass
remain pending; automated tests are a separate verification layer.

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
