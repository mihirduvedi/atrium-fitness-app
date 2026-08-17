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
- interactive grounded AI Coach chat with direct answers, no unsolicited starter message, a vertical device-local thread menu, confirmed deletion, minimized and server-whitelisted context, an authenticated Supabase Edge Function, strict response schema, evidence labels, deterministic fitness/privacy/secret/safety boundaries, protected-output checks, durable per-user rate limiting, timeouts, offline fallback, and validated one-workout proposals that keep the next workout unchanged, remove eligible back-off sets, or apply an engine-triggered deload only after explicit Apply
- deterministic Coach adaptation derived from completed active-Program history, readiness on health/check-in-backed days in the recent seven-day window, and the scheduled week-7 checkpoint; the deload transforms one workout to about 40% fewer working sets, plate-rounded loads about 10% lower, and no top sets while leaving the persistent Program structure unchanged and preserving the unmodified plan's next progression state
- exact Apply-time proposal revalidation, per-user start serialization, and atomic workout/draft/normal program-state/sync persistence with full rollback on failure; a completed deload cools repeated acute signals for seven days and suppresses another scheduled deload in the same block
- RLS-owned `workout_training_intents` persistence with a bounded exact engine base/resume snapshot on newly applied deloads for cross-device active-workout recovery; early schema-v12 converted null snapshots and any snapshot that does not exactly match current Program slots/state fail closed
- atomic remote publication for recognized adjacent workout+intent pairs created by the current Apply path; converted early-v12 markers can use ordinary single-row upserts; database-time pull barriers use a five-minute ordinary replay and full backfill for an ahead cursor, with all-table server timestamps, complete 500-row composite-keyset paging, one-time cursor backfill, and server-authoritative clean rows with transactional dirty-local protection
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

- Mobile database, query, sync, health, Coach context/chat/history/model/evaluation/adaptation/proposal, photo, workout-queue, numeric-input, rest-timer, and subscription suites
- Engine and design-token suites
- Workspace typecheck
- iOS export
- native iOS simulator build and screenshot pass for the previously documented app surfaces
- prior local Supabase/Groq Coach gate and iOS simulator pass for the previously documented chat and unchanged/volume-reduction proposal paths, including authenticated model replies, grounded evidence, deterministic boundaries, persistent conversation history, deletion confirmation, and offline fallback
- automated one-session-deload coverage for active-Program history, health/check-in-backed readiness and week-7 triggers, minimized model context, opaque option selection, exact revalidation, transaction rollback, cooldown, and offline fallback
- schema-v11-compatible side-table intent/snapshot migration, early-v12 local/queue conversion with null-snapshot fail-closed coverage, two-device schema-v12 automated sync coverage, exact reconstruction for newly applied deloads, and malformed/tampered/stale snapshot rejection; production creation remains gated
- local Supabase application and zero-error lint for migration `0006`, plus rollback-only PostgreSQL proofs of owner RLS, atomic pair success/failure, database timestamp override, and complete 500/500/205 paging of 1,205 equal-timestamp rows
- a prior iPhone 17 UI/fallback pass covered the week-7 review through durable Applied/Resume before the synced side-table revision; current native evidence verifies only the schema-v12 SQLite migration, not the full current integrated flow
- HealthKit authorization/import on a physical iPhone

## Known gaps

These are not bugs; they are areas still planned or in progress.

- RevenueCat dashboard/store configuration and end-to-end native sandbox purchase QA
- production/staging deployment and live-provider evaluation against the locally expected Coach prompt `2026-08-10.8` and schema `2`; evaluator labels are not deployed-version attestation
- deployment of migrations `0005` and `0006`, staging RLS plus atomic/paginated intent/plan-snapshot sync and fail-closed resume verification, and server- or store-enforced minimum supported client version excluding schema-v11 clients before using the exact production opt-in `EXPO_PUBLIC_ATRIUM_ADAPTIVE_DELOAD_ENABLED=1`; minimum-version enforcement is not implemented yet
- checked-in adaptive-deload screenshots and a full current integrated native re-QA pass; the earlier iPhone UI/fallback pass predates the side-table revision, and current native evidence covers only schema-v12 SQLite migration
- AI Coach issue reporting, broader multilingual and obfuscated adversarial coverage, staging rate-limit/RLS verification, and deterministic Program-mutation tools beyond the validated one-workout boundary
- model-generated weekly review
- Exercise media/video library
- Importers from other fitness apps
- deeper recovery-aware Progress insights and body-metric correlations
- offline first-launch row re-keying after later anonymous auth
- onramp week advancement
- full Apple upgrade-in-place credential/device QA
- live Supabase RLS re-verification before a production milestone
- explicit product semantics and conflict UX for simultaneous edits of the same workout on multiple devices

## Next build priorities

1. Finish manual QA and polish of the core free tracker loop.
2. Deploy migrations `0005`/`0006`, verify rate limiting/RLS/atomic paginated sync in staging, implement a server/store minimum-version gate that excludes schema-v11 clients, then use `EXPO_PUBLIC_ATRIUM_ADAPTIVE_DELOAD_ENABLED=1` and repeat the hosted-model plus full integrated native gates with deployed-version attestation and qualified review.
3. Deepen recovery-aware and body-metric Progress insights beyond the completed range and exercise comparisons.
4. Configure the RevenueCat entitlement, offering, and store products, then complete native sandbox purchase QA.
