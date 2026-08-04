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
- eventually interact with an AI coach grounded in their own data

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
- a grounded local Coach experience and Weekly Review
- profile, light/dark appearance, privacy, deferred anonymous auth, and Apple upgrade scaffolding
- SQLite storage, offline sync, Supabase schema/RLS, progression engine, and shared design tokens

## Future ideas

Potential future directions include:

- production AI Coach responses, tools, and safety guardrails
- deeper recovery-aware Progress insights and body-metric correlations
- RevenueCat subscriptions and paywall
- nutrition quick logging only where it strengthens readiness or review
- Strong and Hevy importers
- exercise media and video library
- AI-generated weekly review
- app store launch assets
- onboarding and product demo videos

## Why this project matters to me

Atrium sits at the intersection of my interests in computer science, fitness, design, and storytelling. It is not only a coding project; it is also a product design project.

Building it has made me think more deeply about how technical products become understandable and motivating. The code matters, but so do the brand, onboarding, visuals, user trust, and product story.
