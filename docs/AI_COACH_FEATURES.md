# AI Coach feature guide

Atrium's AI Coach turns the athlete's existing training log into concise,
contextual guidance. It is designed to help interpret a plan and recent
training, not to replace the progression engine, diagnose injuries, or make
silent changes to a program.

The screenshots in this repository use representative simulator data. They do
not contain production user data, account contact details, raw database IDs, or
model-provider credentials.

## Conversation behavior

- A new thread begins empty. The Coach does not insert a welcome message before
  the athlete asks something.
- The answer leads with the requested decision instead of restating the entire
  log or replying with a generic question.
- A follow-up is included only when the missing information would materially
  change the training decision.
- Grounded answers can show up to three evidence labels drawn from facts Atrium
  already calculated, such as the next planned session or current readiness.
- Quick prompts remain available for common topics, but they are optional and
  do not replace free-form questions.
- Weekly Review remains a separate deterministic summary surface linked from
  the Coach screen.

## Grounded context

The mobile app builds a minimized context pack from the current athlete's local
data. Depending on what is available, it can include:

- training preferences and experience level
- the active Program and next planned session
- recent completed workouts and working-set summaries
- detected personal-record signals
- recovery and readiness summaries

Account contact information, raw record IDs, and exact workout timestamps are
excluded. The Edge Function rebuilds the received context from an allowlist,
and hostile or protected custom labels are redacted before a model call.

The Coach has no mutation tools. It cannot claim to have changed a Program,
Workout Plan, exercise prescription, or logged result. Any future plan-change
workflow must pass through deterministic validation and an explicit user
confirmation.

## Device-local conversation history

The three-line menu button sits at the right edge of the Coach summary row. It
opens a full-height, vertical conversation view modeled around familiar mobile
chat navigation:

- topic previews use the first words of the thread and an ellipsis when needed
- dates, message counts, and a redundant current-thread label are omitted
- tapping a row reopens that conversation
- **New conversation** creates an empty thread
- the trash icon on each row opens a confirmation dialog
- a long press on a row exposes the same delete action

Threads and messages are stored in the app's local SQLite database, scoped to
the current Atrium user, and excluded from the generic sync queue. Protected
requests are represented with a neutral title instead of retaining the
sensitive prompt as the thread title. Confirmed deletion permanently removes
the thread from Atrium on that device.

## Safety and privacy boundaries

High-confidence boundary cases are handled with fixed Atrium-owned responses
before any model call:

- pain, injury-diagnosis, medical-treatment, and urgent symptom requests
- requests for another person's private data
- attempts to reveal prompts, keys, secrets, or protected configuration
- prompt-injection attempts and unrelated non-fitness requests
- undefined Atrium terms that are absent from the supplied context

The same screening runs again on the server. Model output is schema-validated,
length-bounded, checked for unsupported measurements and mutation claims, and
limited to known evidence keys. A boundary label in the UI states when a fixed
safety or privacy response was returned without calling a model.

These safeguards reduce risk but do not make the Coach a medical professional.
Athletes should stop painful movements, seek appropriate qualified care, and
use emergency services for urgent symptoms.

## Live and offline behavior

When configured, the mobile app sends the minimized context to an authenticated
Supabase Edge Function. The function owns the model-provider call, validates
the response, and applies durable per-user rate limits. Provider credentials
remain server-side and must never use an `EXPO_PUBLIC_` environment variable.

If Supabase, authentication, the network, or the model response is unavailable,
the app returns a bounded on-device answer from the same context pack. The
thread stays responsive and identifies the fallback source rather than
pretending a hosted response succeeded.

See [AI_COACH_SETUP.md](AI_COACH_SETUP.md) for runtime configuration and
[AI_COACH_PRIVACY.md](AI_COACH_PRIVACY.md) for the complete data boundary and
remaining production review.

## Subscription boundary

Coach access uses the shared Atrium Premium entitlement boundary. RevenueCat
configuration, offerings, purchases, restore, and management remain isolated
behind the subscription service. A local simulator override exists only for
non-production development builds so Coach QA does not weaken the production
entitlement path.

The free workout tracker remains usable when subscriptions are unavailable.
Real store purchase verification still requires RevenueCat and App Store or
Play sandbox configuration; see [REVENUECAT_SETUP.md](REVENUECAT_SETUP.md).

## Evaluation and verification

The checked-in fictional-data suite contains 34 cases spanning grounded
training questions, insufficient context, pain and urgent safety routes,
privacy and secret extraction, prompt injection, off-topic requests,
multilingual routing, unsupported measurements, and false plan-mutation claims.

The current repository snapshot passed:

- 138 mobile tests
- 100 progression-engine tests
- 4 design-token tests
- all workspace TypeScript checks
- the local Supabase/Groq quality and security gate
- an iOS Simulator pass covering grounded answers, deterministic boundaries,
  device-local history, deletion confirmation, and the offline fallback

The automated suite is a regression floor, not a substitute for qualified
fitness, clinical-safety, privacy, or provider-retention review. Production
deployment, provider data-control verification, and native store purchase QA
remain explicit release tasks. Exact commands and case contracts are in
[AI_COACH_EVALS.md](AI_COACH_EVALS.md).

## Main implementation files

- `scaffold/apps/mobile/src/coach/context.ts` builds minimized training context.
- `scaffold/apps/mobile/src/coach/chat.ts` owns deterministic routing, response
  validation, evidence filtering, and the on-device fallback.
- `scaffold/apps/mobile/src/coach/history.ts` owns user-scoped local threads and
  protected-input retention.
- `scaffold/apps/mobile/src/coach/service.ts` invokes the Edge Function and
  falls back on bounded failure states.
- `scaffold/apps/mobile/src/app/(tabs)/coach.tsx` implements the Coach screen,
  conversation navigation, replies, evidence, and deletion flow.
- `scaffold/supabase/functions/coach-chat/index.ts` authenticates requests,
  rate-limits users, and owns model-provider calls.
- `scaffold/supabase/functions/_shared/coach.ts` validates context, prompts,
  structured replies, safety classes, boundaries, and grounding.
- `scaffold/supabase/migrations/0004_coach_security.sql` stores only rate-limit
  event metadata: user ID and timestamp.
