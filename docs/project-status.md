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
- Coach context pack and grounded local replies
- Weekly Review
- Profile, privacy, account state, and light/dark appearance
- Exercise Library, Exercise Detail, search, filtering, and custom movements
- Program Library with schedules, rest-timer settings, editing, adding/removing movements, and drag reordering
- Workout Plan Library with goal filters, active state, editing, and Program management
- Day and night visual states
- Design system documentation and SVG/HTML references
- HealthKit sample storage, native import adapter, and readiness scoring
- daily energy, mood, sleep-quality, soreness, and optional body-weight check-ins that update readiness and Weekly Review

## Verified locally during development

- 100 engine tests
- 57 mobile database, query, sync, health, coach-context, photo, workout-queue, numeric-input, and rest-timer tests
- 4 design-token tests
- Workspace typecheck
- iOS export
- native iOS simulator build and screenshot pass
- HealthKit authorization/import on a physical iPhone

## Known gaps

These are not bugs; they are areas still planned or in progress.

- Revenue/subscription flow
- AI coach backend and model-generated weekly review
- Coach safety guardrails
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
2. Deepen recovery-aware and body-metric Progress insights beyond the completed range and exercise comparisons.
3. Add subscriptions only after the free loop feels excellent.
4. Build the production AI Coach backend, tools, and safety layer.
