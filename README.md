# Atrium

Atrium is a work-in-progress, iOS-first fitness app for offline strength logging, adaptive programming, recovery-aware readiness, and coaching grounded in the user's own training history.

The project explores how a fitness product can combine a reliable technical foundation with thoughtful design, visual storytelling, and user-centered product thinking.

## Why I am building this

Most fitness apps are good at collecting workout data, but less effective at helping users understand what to do next. Atrium is built around the idea that a training log should become an interpretation layer: helping users recognize progress, understand patterns, and receive clearer guidance over time.

This project also reflects my interest in combining computer science and creative tools. I am especially interested in how design, branding, onboarding, and product storytelling can make technical projects feel more complete and accessible.

## Current status

Atrium is in active development. The current app includes:

- offline-first workout logging with durable sets, previous-session context, a rest timer, warm-ups, and reversible checkoffs
- an adaptive TypeScript progression engine used by onboarding and the daily training plan
- Exercise, Program, and Workout Plan libraries with search, filters, scheduling, custom movements, and drag reordering
- Progress analytics, session-by-session workout history with set-level drilldowns, personal-record detection, local progress photos, and weekly review
- a local Coach experience grounded in profile, workout, PR, readiness, and next-plan context
- HealthKit import for sleep, resting heart rate, HRV, steps, and workouts in native iOS builds
- SQLite storage, an offline mutation queue, Supabase sync architecture, row-level security, and deferred anonymous authentication
- light and dark appearance modes built from shared Atrium design tokens

This is an active work-in-progress project, not a finished commercial app. The production AI Coach backend, subscriptions, and importers are intentionally still future work.

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
- pure TypeScript progression, readiness, warm-up, deload, stall, and PR logic
- native HealthKit integration through `@kingstinct/react-native-healthkit`
- automated coverage across the mobile data layer, sync, coach context, photos, engine, and design tokens

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

### Health and readiness

| Connected health samples | Recovery-aware Today |
|---|---|
| ![Profile showing connected health samples](screenshots/health-import-samples.png) | ![Today screen showing readiness calculated from sleep, resting heart rate, and HRV](screenshots/readiness-health-samples.png) |

HealthKit authorization and import require a native development build on a real
iPhone. The readiness capture above uses representative simulator samples
through the same scoring pipeline; the native import path has also been
manually verified on-device.

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
| ![Progress screen](screenshots/progress-first-pass.png) | ![Workout session detail](screenshots/progress-session-detail.jpg) |

### Coaching

| Coach | Weekly Review |
|---|---|
| ![Coach screen](screenshots/coach-first-pass.png) | ![Weekly Review](screenshots/weekly-review.png) |

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

## License

This project is publicly visible for portfolio and application-review purposes,
but it is not open source. All rights are reserved. See [LICENSE](LICENSE) and
[NOTICE.md](NOTICE.md).
