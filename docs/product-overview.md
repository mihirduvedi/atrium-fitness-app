# Atrium Product Overview

Atrium is a work-in-progress, iOS-first fitness app focused on offline strength logging, adaptive programming, recovery-aware readiness, and AI-assisted coaching grounded in real training data.

## The problem

Many workout trackers are good at recording sets, reps, and weight, but they often leave the user to interpret the data alone. A lifter may know what they did last week, but still struggle to answer what to do today, whether they are progressing, or how to adjust when they stall.

Atrium is built around a simple idea: workout history should become guidance.

## The concept

Atrium begins as a reliable strength training tracker. Over time, it is designed to become a coaching layer that uses the user's own training history to support better decisions.

The app is intended to help users:

- log workouts quickly
- see previous-session context while training
- track progress over time
- understand personal records and volume trends
- receive adaptive programming suggestions
- reflect on recovery and consistency
- interact with an AI coach grounded in their own data

## Product model

Atrium uses three product concepts consistently:

1. An **Exercise** is one movement.
2. A **Program** groups Exercises.
3. A **Workout Plan** groups Programs around a goal such as strength, muscle, weight loss, or agility.

The current storage model predates this user-facing language, so the app maps these concepts onto the existing schema rather than duplicating the data model.

## Target user

The initial target user is a committed intermediate lifter who trains consistently and wants more guidance than a basic logging app provides.

This user likely cares about:

- progressive overload
- workout consistency
- strength trends
- recovery
- simple logging
- practical coaching feedback

## Product principles

### 1. Logging should stay fast

The app should not make users fight the interface during a workout. The training flow should be simple, durable, and usable in the gym.

### 2. Data should become interpretation

A workout history is only valuable if it helps the user make better decisions. Atrium's long-term direction is to translate logs into useful feedback.

### 3. Coaching should be grounded

AI coaching should not feel generic. It should be connected to the user's actual sessions, progress, preferences, and recovery patterns.

### 4. Design should feel calm and focused

The visual direction avoids loud fitness-app cliches. Atrium uses restrained typography, warm surfaces, clear hierarchy, and minimal color so training data remains the focus.

## Current product areas

The current project includes:

- onboarding that generates an initial plan through the progression engine
- Today, Active Workout, and Workout Summary flows backed by local data
- durable set logging, previous-session values, numeric workout inputs, per-program between-set rest timing, warm-ups, movement skipping, early exercise completion, and queue reordering
- Exercise Library, custom movements, exercise detail, history, and PR trends
- Program Library with scheduling, editing, movement management, and reordering
- Workout Plan Library with goals, notes, active state, and Program management
- Progress analytics with selectable 4/12-week period comparisons, exercise-level e1RM changes, workout session drilldowns with set-level detail, and a local-only progress-photo timeline
- readiness calculated from HealthKit and subjective signals
- a daily check-in for energy, mood, sleep quality, soreness, and optional body weight that feeds Today and Weekly Review
- interactive grounded AI Coach chat that starts empty and answers the question first, with evidence labels, a vertical device-local thread menu, confirmed deletion, minimized context, deterministic fitness/privacy/secret/safety boundaries, authenticated rate-limited server inference, an offline fallback, and validated one-workout proposals that keep the next workout unchanged, remove eligible back-off sets, or apply an engine-triggered one-session deload only after explicit review and Apply
- profile, light/dark appearance, privacy, deferred anonymous auth, and Apple upgrade scaffolding
- SQLite storage, offline sync, Supabase schema/RLS, progression engine, and shared design tokens

The deload decision comes from the deterministic engine rather than the model.
It considers completed working-set history from the active Program, recorded
readiness only on dates with health or subjective check-in input in the recent
seven-day window, and the upcoming week. Two distinct current-week
stalls, at least three recorded red-readiness days, or the scheduled week-7
checkpoint can open the deload option. Dates without a health sample or
subjective check-in are omitted rather than filled in as green.

The action changes one new workout draft to about 40% fewer working sets,
plate-rounded loads about 10% lower, and no top sets. It preserves exercise and
slot identity, rest periods, and the normal engine-authored progression state;
the persistent Program structure and later schedule remain unchanged. Apply is
explicit, revalidates the active workout, readiness, active Program/day, signal,
fresh plan fingerprint, and exact opaque option, then commits the workout,
normal program-state advances, sync mutations, and draft atomically. A failure
rolls the whole write back. A completed deload suppresses repeated acute signals
for the recent seven-day window and another scheduled week-7 deload in the same
block.

The deload marker is synced in a dedicated `workout_training_intents` table so
the existing workout row contract stays compatible with schema-v11 clients.
For a newly applied deload, its RLS-owned row carries the intent plus a bounded,
versioned snapshot of the exact engine base/resume plans:
Program-day/slot/exercise references, session name/week/readiness, per-slot
rule/rest/progression state, warm-up and working
set indices/kinds, rep or time targets, plate-rounded loads, and deterministic
engine notes/kind. The opaque proposal ID is stripped,
and no chat or model output is stored. Atrium consults this snapshot only to
resume an already-active deload across devices; it must still match the exact
engine transform and current Program slots/state, or recovery fails closed into
an explicit no-logging Sync/retry/discard screen.
An early schema-v12 development marker converted from the retired workout
column may have no plan snapshot; it remains progression-safe but cannot be
resumed without a local draft, so recovery fails closed.
For newly applied deloads, the sync layer keeps workout+intent adjacent and
commits the recognized pair through one RLS-enforced server RPC. Converted
early-v12 markers can use ordinary single-row upserts. Database-time barriers,
a five-minute overlap for ordinary pulls, full historical backfill for an ahead
cursor, all-table server
timestamps, and complete `(updated_at, primary key)` keyset pages prevent fast
device clocks, 1,000-row response caps, or a failed later page from creating a
partially advanced peer view.
Production creation requires the exact opt-in
`EXPO_PUBLIC_ATRIUM_ADAPTIVE_DELOAD_ENABLED=1`, which must stay off until a
server- or store-enforced minimum supported client version excludes schema-v11
syncing clients. That minimum-version enforcement is not implemented yet;
local development keeps the complete flow available for QA.

Automated coverage for this pipeline is checked in, including offline fallback
selection and rollback behavior. A prior iPhone 17 UI/fallback pass covered the
week-7 review through Applied/Resume, but it predates the synced side-table
revision. Current native evidence proves only the schema-v12 SQLite migration.
Full integrated native re-QA, checked-in deload screenshots, staging deployment
of migrations `0005`/`0006` and the updated Coach function, and minimum-version enforcement remain
pending.

## Future ideas

Potential future directions include:

- deployment and live evaluation against the locally expected AI Coach prompt `2026-08-10.8` and schema `2`, with deployed-version attestation, deload-specific native QA, qualified domain/privacy review, issue reporting, multilingual and obfuscated adversarial coverage, staging security verification, and broader Program-level plan-adjustment tools that remain inside deterministic engine rules
- deeper recovery-aware Progress insights and body-metric correlations
- RevenueCat store configuration and native sandbox purchase QA
- nutrition quick logging only where it strengthens readiness or review
- Strong and Hevy importers
- exercise media and video library
- AI-generated weekly review
- app store launch assets
- onboarding and product demo videos

## Why this project matters to me

Atrium sits at the intersection of my interests in computer science, fitness, design, and storytelling. It is not only a coding project; it is also a product design project.

Building it has made me think more deeply about how technical products become understandable and motivating. The code matters, but so do the brand, onboarding, visuals, user trust, and product story.
