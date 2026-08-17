# Atrium

Atrium is a work-in-progress, iOS-first fitness app for offline strength logging, adaptive programming, recovery-aware readiness, and coaching grounded in the user's own training history.

The project explores how a fitness product can combine a reliable technical foundation with thoughtful design, visual storytelling, and user-centered product thinking.

## Why I am building this

Most fitness apps are good at collecting workout data, but less effective at helping users understand what to do next. Atrium is built around the idea that a training log should become an interpretation layer: helping users recognize progress, understand patterns, and receive clearer guidance over time.

This project also reflects my interest in combining computer science and creative tools. I am especially interested in how design, branding, onboarding, and product storytelling can make technical projects feel more complete and accessible.

## Current status

Atrium is in active development. The current app includes:

- offline-first workout logging with durable sets, previous-session context, a per-program between-set rest timer, early exercise completion, warm-ups, numeric inputs, and reversible checkoffs
- an adaptive TypeScript progression engine used by onboarding and the daily training plan
- Exercise, Program, and Workout Plan libraries with search, filters, scheduling, custom movements, and drag reordering
- Progress analytics with 4/12-week and exercise-level comparisons, session-by-session workout history with set-level drilldowns, personal-record detection, local progress photos, and weekly review
- a daily recovery and body-weight check-in that updates readiness, planned training stress, real seven-day weight trends, and Weekly Review context
- an interactive AI Coach grounded in minimized profile, workout, PR, readiness, next-plan, and adaptation context, with device-local deletable threads, authenticated server calls, fixed fitness/privacy/secret boundaries, durable per-user rate limiting, evidence labels, an offline fallback, and validated one-workout proposals that can keep the next workout unchanged, remove eligible back-off sets, or apply an engine-triggered deload only after explicit review and Apply
- a soft RevenueCat paywall with dynamic store pricing, restore/manage actions, and a free tracker that remains usable when subscriptions are unavailable
- HealthKit import for sleep, resting heart rate, HRV, steps, and workouts in native iOS builds
- SQLite storage, an offline mutation queue, Supabase sync architecture, row-level security, and deferred anonymous authentication
- light and dark appearance modes built from shared Atrium design tokens

The adaptive deload signal is deterministic. It uses completed working-set
history from the active Program, readiness computed only for dates backed by
health or subjective check-in input in the recent seven-day window, the upcoming
Program week, and prior completed deloads for cooldown. A deload becomes
eligible when two distinct lifts meet their current-week stall criteria, at
least three recorded readiness days are red, or week 7 reaches its scheduled
checkpoint. The resulting action is bounded to one workout: about 40% fewer working sets,
plate-rounded loads about 10% lower, and no top sets. The persistent Program
structure, exercise identity, and engine-authored progression state are
unchanged by that transformation.

A newly applied deload is saved and synced through a bounded
`workout_training_intents` row. A live row (`deleted_at is null`) marks
`coach_deload`; ordinary workouts have no live intent row, though a synced
tombstone can remain. The row also carries a versioned, bounded
`plan_json` snapshot of the exact engine base and resumable deload plan:
Program-day/slot/exercise references, session week/readiness, engine-authored
per-slot progression state, sets, rep targets, rest, plate-rounded loads, and
engine notes/kind. The opaque proposal ID is stripped, and no chat or model
output is stored there. RLS binds the row to the authenticated owner of its
workout. An early schema-v12 development marker converted from the retired
workout column may have `plan_json = null`; it still protects progression
history, but cross-device resume fails closed because no plan can be trusted.

For newly applied deloads, the local queue never splits the adjacent workout →
intent/snapshot pair at a batch boundary, and migration `0006` publishes that
recognized pair through one idempotent PostgreSQL transaction. Sets remain
later children of an already marked workout. Converted early-v12 markers may
use the ordinary single-row upsert path and are not claimed as atomically paired.
Every synced insert/update receives database time; ordinary
pulls use a database-time upper barrier with a five-minute replay overlap, while
a cursor ahead of database time triggers a full historical backfill. Every pull
exhausts 500-row keyset pages by `(updated_at, primary key)`. A receiving device
therefore does not trust its own clock or silently stop at the Data API's
1,000-row response cap. The client also performs a one-time cursor rewind when
adopting this pull contract so rows skipped by an earlier build are backfilled.

The snapshot is used only to resume an already-active deload across devices. A
receiving client verifies that the resume plan is the exact engine deload of the
base plan and still matches the current Program slots and state; missing,
tampered, or stale data fails closed into a no-logging recovery screen with
**Sync & retry**, explicit discard, and return-to-Today actions. Today never
replans or auto-discards a synced active Coach workout while its local draft is
missing. Completed sets remain visible in workout
history and Progress analytics, while normal progression history and stall
detection exclude those intentionally lowered sets. The separate table
preserves the existing `workouts` sync shape for older installed clients.

The checked-in automated suites cover the engine, adaptation signal, context
minimization, proposal selection, exact Apply-time revalidation, atomic local
persistence and rollback, cooldown behavior, offline fallback, and the broader
mobile data layer. The checked-in function and evaluator locally expect prompt
`2026-08-10.8`, schema `2`; those local labels do not attest which version is
deployed. Supabase migrations `0005_workout_training_intent.sql` and
`0006_sync_pull_safety.sql` must be applied before releasing a schema-v12
client that queries the side table and its sync RPCs. The only production opt-in syntax is
`EXPO_PUBLIC_ATRIUM_ADAPTIVE_DELOAD_ENABLED=1`. It must remain unset until a
server- or store-enforced minimum supported client version excludes schema-v11
syncing clients; that enforcement is not implemented yet. A prior iPhone 17
simulator UI/fallback pass predates the synced side-table revision. Current
native evidence proves only the schema-v12 SQLite migration. Migration `0006`
has been applied and linted only against local Supabase, where rollback-only
proofs covered owner RLS, atomic success/failure, server timestamps, and 1,205
equal-timestamp rows across three keyset pages. Full integrated native re-QA,
checked-in deload screenshots, staging migration/function deployment, and
the live hosted-model gate remain pending.

This is an active work-in-progress project, not a finished commercial app. Production AI Coach deployment and provider privacy review, store subscription configuration, and importers are intentionally still future work.

## Core product idea

Atrium starts with a dependable strength-training loop and gradually expands toward an AI coach grounded in real user data.

The product language follows this hierarchy:

1. An **Exercise** is one movement.
2. A **Program** is a group of Exercises.
3. A **Workout Plan** is a goal-based collection of Programs.

The long-term goal is to help users answer questions like:

- What should I train today?
- Am I progressing?
- Why might I be stalling?
- How should my plan adapt based on recent workouts and recovery?

## Technical highlights

- React Native 0.85 and Expo SDK 56
- Expo Router and TypeScript 6 monorepo
- local-first SQLite storage
- offline mutation queue with retries, tombstones, cursors, and conflict handling
- Supabase schema, anonymous auth, and row-level security
- authenticated Supabase Edge Function for schema-validated OpenAI Responses API calls, with server-whitelisted context, server-only credentials, protected-output checks, and a service-role-only rate-limit RPC
- pure TypeScript progression, readiness, warm-up, stall, PR, and adaptive one-session deload logic
- opaque, device-constructed Coach actions with exact Apply-time revalidation and atomic workout-draft/program-state persistence
- native HealthKit integration through `@kingstinct/react-native-healthkit`
- RevenueCat subscription state, offering, purchase, restore, and management integration through `react-native-purchases`
- automated coverage across the mobile data layer, sync, coach context/chat evaluations, photos, engine, and design tokens

## Design direction

Atrium uses a restrained, warm visual system inspired by fitness journaling, recovery apps, and premium productivity tools. The design emphasizes:

- calm paper and graphite surfaces
- fast, clear workout logging
- minimal color outside data and state
- strong typography and spacing
- clear hierarchy for progress, readiness, and coaching feedback

## Screenshots

### Core training loop

| Today | Active Workout | Summary |
|---|---|---|
| ![Today screen](screenshots/today-focused.png) | ![Active Workout screen](screenshots/workout-focused.png) | ![Workout Summary screen](screenshots/summary-focused.png) |

### Health, readiness, and daily check-in

| Connected health samples | Recovery-aware Today | Daily check-in |
|---|---|---|
| ![Profile showing connected health samples](screenshots/health-import-samples.png) | ![Today screen showing readiness calculated from sleep, resting heart rate, and HRV](screenshots/readiness-health-samples.png) | ![Daily recovery and body-weight check-in](screenshots/daily-check-in.png) |

HealthKit authorization and import require a native development build on a real
iPhone. The readiness and daily-check-in captures above use representative
simulator data through the same local scoring pipeline; the native import path
has also been manually verified on-device.

### Libraries

| Program Library | Workout Plans | Exercise Library |
|---|---|---|
| ![Program Library](screenshots/program-library.png) | ![Workout Plan Library](screenshots/workout-plan-library.png) | ![Exercise Library](screenshots/library-first-pass.png) |

### Building Programs

| Schedule a new Program | Edit Program details | Add and reorder movements |
|---|---|---|
| ![New Program with a Saturday schedule](screenshots/new-program-schedule.png) | ![Program editor with categories and scheduling controls](screenshots/program-editor.png) | ![Program movement list with remove and reorder controls](screenshots/program-movements-reorder.png) |

| Browse the movement catalog | Configure an Exercise | Create a custom movement |
|---|---|---|
| ![Movement catalog and Program prescription controls](screenshots/add-movement-to-program.png) | ![Selected Exercise with sets, reps, and Add to Program](screenshots/configure-exercise-for-program.png) | ![Custom movement builder](screenshots/custom-movement-builder.png) |

### Building Workout Plans

| Create a Workout Plan | Assemble its Programs |
|---|---|
| ![New Workout Plan builder](screenshots/new-workout-plan.png) | ![Workout Plan editor with included Programs](screenshots/workout-plan-editor.png) |

### Progress and workout history

| Progress | Workout session detail |
|---|---|
| ![Progress analytics](screenshots/progress-analytics.png) | ![Workout session detail](screenshots/progress-session-detail.jpg) |

### AI Coach

The Coach now answers the question first, cites the supplied training facts when
they support the decision, and asks a follow-up only when missing information
would materially change the recommendation. New threads open empty rather than
inserting an unsolicited welcome message.

| Grounded training guidance | Safety boundary | Privacy boundary |
|---|---|---|
| ![Coach answering what workout to do from readiness and the next planned session](screenshots/coach-grounded-guidance.png) | ![Coach declining to diagnose knee pain and directing the athlete to qualified care](screenshots/coach-safety-boundary.png) | ![Coach refusing a request for another user's private workout records](screenshots/coach-privacy-boundary.png) |

Conversation history opens from the menu button beside the Coach context
summary. Threads appear vertically with short topic previews; they stay on the
device, can be reopened, and require confirmation before permanent deletion.

| Conversation history | Delete confirmation | Weekly Review |
|---|---|---|
| ![Vertical device-local Coach conversation history](screenshots/coach-conversations.png) | ![Coach conversation deletion confirmation](screenshots/coach-delete-confirmation.png) | ![Weekly Review](screenshots/weekly-review.png) |

A Coach answer can also offer a validated action for one workout: start the
next planned workout unchanged, remove one or two eligible back-off sets, or
use an engine-triggered deload. The device constructs at most three opaque
options, and the provider can select only an exact supplied ID. Nothing changes
until the athlete explicitly applies the proposal. Apply regenerates the current
signal and plan, re-resolves that exact option, and atomically saves the workout,
draft, normal engine progression state, and sync mutations or rolls all of them
back. The deload itself does not rewrite the persistent Program or later days.

| Proposal ready | Proposal applied | Resulting workout |
|---|---|---|
| ![Coach proposal ready for explicit review and Apply](screenshots/coach-proposal-ready.png) | ![Coach proposal marked applied with a resume action](screenshots/coach-proposal-applied.png) | ![Workout created with the approved back-off-set reduction](screenshots/coach-proposal-workout.png) |

These existing proposal captures document the unchanged/volume-reduction path.
They are not images of the newer adaptive-deload state. The earlier local
iPhone 17 interaction pass predates the synced side-table revision; current
native evidence covers only the schema-v12 SQLite migration. Deload-specific
captures and a full integrated native re-QA pass remain pending.

See the [AI Coach feature guide](docs/AI_COACH_FEATURES.md) for the user
experience, grounding boundary, conversation behavior, one-workout proposal
boundary, safety routes, offline fallback, subscription boundary, and
verification coverage.

### More product surfaces

| Progress Photos | Profile | Libraries |
|---|---|---|
| ![Progress Photos](screenshots/progress-photos.png) | ![Profile screen](screenshots/profile-first-pass.png) | ![Libraries hub](screenshots/libraries-hub.png) |

| Onboarding | Exercise Detail |
|---|---|
| ![Onboarding screen](screenshots/onboarding-first-pass.png) | ![Exercise Detail](screenshots/exercise-detail-first-pass.png) |

## Project structure

```text
atrium-fitness-app/
  scaffold/              # Expo app, engine, tokens, tests, and Supabase schema
  docs/design/           # Design system, HTML prototypes, and SVG boards
  docs/product-overview.md
  docs/project-status.md
  screenshots/           # Current simulator screenshots
```

## Connection to creative tools

Atrium is also a project where I want to explore how creative tools can support student-built software. Beyond the code, the product needs a visual identity, onboarding content, app store assets, demo videos, and launch materials.

This is where tools like Adobe Premiere Pro, Photoshop, Illustrator, Express, and Firefly could play a major role.

## Running the project

The technical workspace is in `scaffold/`.

```bash
cd scaffold
npm install
npm run typecheck
npm test
```

Start the Expo development server:

```bash
npm run mobile
```

Native HealthKit and Apple authentication require an iOS development build rather than Expo Go:

```bash
npm run ios --workspace mobile
```

Copy `scaffold/apps/mobile/.env.example` to `.env` and supply your own local Supabase URL and anonymous key when testing sync. No private environment file is included in this repository.

The live AI Coach also needs a server-side OpenAI secret and a running or deployed Supabase function. See [`docs/AI_COACH_SETUP.md`](docs/AI_COACH_SETUP.md); never place that secret in an `EXPO_PUBLIC_` variable.

Before changing the Coach model or prompt, run the deterministic regression suite and the opt-in live endpoint evaluation described in [`docs/AI_COACH_EVALS.md`](docs/AI_COACH_EVALS.md).

The Coach data boundary, local thread behavior, and remaining production security work are documented in [`docs/AI_COACH_PRIVACY.md`](docs/AI_COACH_PRIVACY.md).

The complete product behavior is summarized in [`docs/AI_COACH_FEATURES.md`](docs/AI_COACH_FEATURES.md).

## License

This project is publicly visible for portfolio and application-review purposes,
but it is not open source. All rights are reserved. See [LICENSE](LICENSE) and
[NOTICE.md](NOTICE.md).
