# Project Status

Atrium is currently in active development. This file summarizes the public project state as of August 2026 without including private workspace paths, environment values, or internal development notes.

## Built or partially built

- Expo SDK 56 / React Native 0.85 mobile app
- TypeScript monorepo structure
- Expo Router mobile navigation
- Shared design tokens package
- Workout progression engine
- Local SQLite schema and data access layer
- Offline mutation queue and sync engine
- Supabase migration and seed setup
- deferred anonymous authentication and Apple upgrade scaffolding
- onboarding and engine-selected initial program
- Today, Active Workout, and Workout Summary flows
- reversible set logging, numeric workout inputs, warm-ups, per-program between-set rest timers, movement skipping, early exercise completion, and workout queue reordering
- Progress analytics with SQLite-backed 4/12-week and exercise-level comparisons, PR detection, and workout session drilldowns with readiness, set, warm-up, and record detail
- local-only Progress Photos timeline with tags, filtering, editing, and deletion
- interactive grounded AI Coach chat with direct answers, no unsolicited starter message, a vertical device-local thread menu, confirmed deletion, minimized and server-whitelisted context, an authenticated Supabase Edge Function, strict response schema, evidence labels, deterministic fitness/privacy/secret/safety boundaries, protected-output checks, durable per-user rate limiting, timeouts, offline fallback, validated one-workout proposals that keep the next workout unchanged or remove one or two eligible back-off sets only after explicit Apply, and a 35-case local/live evaluation harness; proposals affect only the new workout draft, leave the Program unchanged, and do not yet provide broader Program mutation
- Weekly Review
- Profile, privacy, account state, and light/dark appearance
- Exercise Library, Exercise Detail, search, filtering, and custom movements
- Program Library with schedules, rest-timer settings, editing, adding/removing movements, and drag reordering
- Workout Plan Library with goal filters, active state, editing, and Program management
- Day and night visual states
- Design system documentation and SVG/HTML references
- HealthKit sample storage, native import adapter, and readiness scoring
- daily energy, mood, sleep-quality, soreness, and optional body-weight check-ins that update readiness and Weekly Review
- soft RevenueCat paywall with dynamic store packages, purchase/restore/manage actions, and explicit free/premium feature boundaries

## Verified locally during development

- 157 mobile database, query, sync, health, coach-context/chat/history/model/evaluation/proposal, photo, workout-queue, numeric-input, rest-timer, and subscription tests
- 101 engine tests
- 4 design-token tests
- 262 automated tests total
- Workspace typecheck
- iOS export
- native iOS simulator build and screenshot pass
- local Supabase/Groq Coach gate and iOS simulator pass with authenticated model replies, grounded evidence, deterministic boundaries, persistent conversation history, deletion confirmation, and offline fallback
- HealthKit authorization/import on a physical iPhone

## Known gaps

These are not bugs; they are areas still planned or in progress.

- RevenueCat dashboard/store configuration and end-to-end native sandbox purchase QA
- production/staging AI Coach deployment, provider data-control verification, and qualified privacy/domain review; the local hosted-model gate and simulator path are verified
- AI Coach live evaluation and qualified domain/privacy review, issue reporting, multilingual and obfuscated adversarial coverage, staging rate-limit/RLS verification, and broader deterministic Program-mutation tools beyond the validated one-workout proposal boundary
- model-generated weekly review
- Exercise media/video library
- Importers from other fitness apps
- deeper recovery-aware Progress insights and body-metric correlations
- offline first-launch row re-keying after later anonymous auth
- onramp week advancement
- full Apple upgrade-in-place credential/device QA
- live Supabase RLS re-verification before a production milestone
- server-authoritative conflict versions before concurrent multi-device editing

## Next build priorities

1. Finish manual QA and polish of the core free tracker loop.
2. Deploy the AI Coach migration/function, verify rate limiting and RLS in staging, and repeat the 35-case hosted-model gate with qualified review.
3. Deepen recovery-aware and body-metric Progress insights beyond the completed range and exercise comparisons.
4. Configure the RevenueCat entitlement, offering, and store products, then complete native sandbox purchase QA.
