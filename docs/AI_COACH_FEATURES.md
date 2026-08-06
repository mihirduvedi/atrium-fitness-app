# AI Coach feature guide

Atrium's AI Coach turns the athlete's existing training log into concise,
contextual guidance. It can now attach a validated, one-workout proposal to an
answer when the athlete is deciding what to do next. It does not replace the
progression engine, diagnose injuries, rewrite the active Program, or make a
silent change.

The screenshots in this repository use representative simulator data. They do
not contain production user data, account contact details, raw database IDs, or
model-provider credentials.

## Conversation behavior

- A new thread begins empty. The Coach does not insert a welcome message before
  the athlete asks something.
- The answer leads with the requested decision instead of restating the entire
  log or replying only with a generic question.
- When part of a question is unsupported, the Coach briefly identifies the
  missing fact and still answers the supported part from the nearest relevant
  program or recovery evidence.
- A follow-up is included only when the missing information would materially
  change the training decision.
- A current fatigue or run-down report is treated as relevant input for the
  immediate decision. When a validated volume-reduction option exists, a green
  recovery score does not override that report.
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

The hosted response contract is schema version `2`; the current system prompt
is `2026-08-05.7`. The exact response fields are `answer`, `evidenceKeys`,
`followUp`, `safetyClass`, `boundaryClass`, and nullable `proposalId`. Extra
fields, including model-generated tool arguments, invalidate the response.

## Validated one-workout proposals

The current action scope is intentionally narrow:

- start the next planned workout unchanged; or
- remove the final one or two non-warm-up back-off sets from the first eligible
  movement, while retaining at least one back-off set.

A reduction preserves warm-ups, the top set, loads, reps, exercise identity,
untargeted movements, and the rest of the session. It changes only the newly
created workout draft. It does not rewrite the Program, modify previous logs,
or schedule later workouts.

The proposal boundary is layered:

1. The device previews the current next session through the deterministic
   engine and constructs at most three eligible options.
2. Each option receives an opaque deterministic ID shaped like
   `cp_0123456789abcdef`. The ID is derived from the plan fingerprint and action;
   it is not a program, day, workout, exercise, or slot database ID.
3. The provider sees only each option's ID, bounded kind, and human-readable
   summary. Target slot IDs and the full local proposal object stay on-device.
4. The Edge Function independently validates and bounds the options, rejects
   conflicting duplicate IDs, drops protected summaries, and exposes only the
   option kinds relevant to the athlete's immediate question.
5. The model can return only one exact supplied ID or `null`. The server and
   client both discard an invented, malformed, expired, or unoffered ID. The ID
   is never accepted as a mutation instruction by itself.

The Coach answer and proposal are separate. A card shows the exact before/after
set count and what remains unchanged. Nothing is written until the athlete
presses **Apply & start workout** (or **Start planned workout** for the unchanged
option).

At Apply time, the device rechecks the active workout, current Program day,
current readiness, regenerated plan fingerprint, selected option, and engine
validation:

- red readiness fails closed as stale and does not create a workout
- a changed plan or no-longer-valid option expires the card and asks for a new
  Coach answer
- a different active workout blocks the proposal and routes the athlete to
  resume that workout
- an already active workout carrying the same proposal ID returns the existing
  workout instead of creating another one
- concurrent Apply requests are serialized per user; duplicate IDs resolve to
  the existing workout, different IDs do not get mislabeled as applied, and
  automated tests require exactly one live workout and one draft
- if the plan changes between the preview and draft write, the newly opened
  workout is discarded and the proposal returns stale

On success, Atrium saves one proposal-marked local draft and opens the normal
workout screen. The proposal card changes to **Applied** with **Resume workout**.
While any workout is active, new model-selectable proposal options are withheld.

The on-device fallback uses the same option set. It can select a one-set
reduction for an explicit tired/run-down request, or the unchanged plan for a
clear next-workout question. It never returns an action under red readiness and
cannot invent a fourth option.

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
limited to known evidence keys and proposal IDs. Safety and boundary replies
always carry `proposalId: null`. A boundary label in the UI states when a fixed
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

## Screenshot evidence

The repository includes three representative proposal states:

![Validated proposal awaiting explicit Apply and Start](../screenshots/coach-proposal-ready.png)

![Applied proposal linked to the existing workout](../screenshots/coach-proposal-applied.png)

![Workout draft with the proposed reduction](../screenshots/coach-proposal-workout.png)

These PNGs document rendered simulator states and contain only representative
data. They do not by themselves claim that a tester manually performed every
tap or completed every state transition. The transitions and write boundaries
are verified by automated tests described below.

## Evaluation and verification

The checked-in fictional-data answer suite contains 35 cases spanning grounded
training questions, insufficient context, direct readiness decisions, current
fatigue, pain and urgent safety routes, privacy and secret extraction, prompt
injection, off-topic requests, multilingual routing, unsupported measurements,
proposal selection, and false plan-mutation claims. Three staging-only security
cases exercise authentication, database permissions, concurrent rate limiting,
metadata minimization, and `Retry-After` behavior.

Proposal-specific automated coverage verifies:

- deterministic opaque IDs and unchanged/one-set/two-set option construction
- engine validation and preservation of protected and untargeted work
- client and server option sanitization, message-level filtering, exact response
  shape, and dual allowlisting of returned IDs
- safe history handling for valid, malformed, and protected stored replies
- no proposal on safety/boundary answers or red readiness
- stale plan/readiness rejection, active-workout race handling, per-user
  serialization, idempotent duplicate Apply, and exactly one saved draft

On August 5, 2026, the focused Coach command in
[AI_COACH_EVALS.md](AI_COACH_EVALS.md) passed 5 test files and 80 tests. That is
an automated code-path result; it is not a claim that the native tap sequence
was manually completed.

The automated suite is a regression floor, not a substitute for qualified
fitness, clinical-safety, privacy, provider-retention, or native interaction
review. Exact commands and case contracts are in
[AI_COACH_EVALS.md](AI_COACH_EVALS.md).

## Main implementation files

- `apps/mobile/src/coach/context.ts` builds minimized training context and the
  current proposal option set.
- `apps/mobile/src/coach/proposals.ts` constructs, validates, applies, marks,
  rechecks, and idempotently starts one-workout proposals.
- `apps/mobile/src/coach/chat.ts` owns deterministic routing, response
  validation, evidence/proposal filtering, and the on-device fallback.
- `apps/mobile/src/coach/history.ts` owns user-scoped local threads and
  protected-input retention.
- `apps/mobile/src/coach/service.ts` invokes the Edge Function and falls back on
  bounded failure states.
- `apps/mobile/src/app/(tabs)/coach.tsx` implements the Coach screen,
  conversation navigation, proposal cards, replies, evidence, and deletion.
- `supabase/functions/coach-chat/index.ts` authenticates requests, filters
  message-relevant options, rate-limits users, and owns model-provider calls.
- `supabase/functions/_shared/coach.ts` validates context and options, defines
  prompt `2026-08-05.7` and schema `2`, and allowlists structured replies.
- `apps/mobile/test/coachProposals.test.ts` covers proposal construction and the
  one-workout write boundary; the other Coach tests cover chat, context, history,
  and evaluator integration.
- `supabase/migrations/0004_coach_security.sql` stores only rate-limit event
  metadata: user ID and timestamp.
