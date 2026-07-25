-- Custom movement metadata for user-created exercise library rows.

alter table public.exercises
  add column if not exists description text,
  add column if not exists default_sets int,
  add column if not exists default_reps int;
