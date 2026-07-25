# Project Status

Atrium is currently in active development. This file summarizes the public project state as of July 2026 without including private workspace paths, environment values, or internal development notes.

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
- reversible set logging, warm-ups, rest timing, movement skipping, and workout queue reordering
- Progress analytics and PR detection
- local-only Progress Photos timeline with tags, filtering, editing, and deletion
- Coach context pack and grounded local replies
- Weekly Review
- Profile, privacy, account state, and light/dark appearance
- Exercise Library, Exercise Detail, search, filtering, and custom movements
- Program Library with schedules, editing, adding/removing movements, and drag reordering
- Workout Plan Library with goal filters, active state, editing, and Program management
- Day and night visual states
- Design system documentation and SVG/HTML references
- HealthKit sample storage, native import adapter, and readiness scoring

## Verified locally during development

- 100 engine tests
- 43 mobile database, query, sync, health, coach-context, and photo tests
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
- stronger workout-history and Progress drilldowns
- offline first-launch row re-keying after later anonymous auth
- onramp week advancement
- full Apple upgrade-in-place credential/device QA
- live Supabase RLS re-verification before a production milestone
- server-authoritative conflict versions before concurrent multi-device editing

## Next build priorities

1. Finish manual QA and polish of the core free tracker loop.
2. Improve workout history and Progress analytics.
3. Add quick logging only where it strengthens readiness and weekly review.
4. Add subscriptions only after the free loop feels excellent.
5. Build the production AI Coach backend, tools, and safety layer.
