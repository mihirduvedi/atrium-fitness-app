# AI Coach privacy and security boundary

This document records what the current Atrium Coach sends, stores, rejects, and still needs before production. It is an engineering boundary, not a claim of perfect confidentiality or medical safety.

## Data flow

1. The mobile app computes a context pack from the authenticated user's local profile, current program, completed workouts, personal-record signals, recovery state, a deterministic preview of the next Program day, and a deterministic adaptation signal. That signal uses completed working-set history from the active Program, readiness only on dates backed by health or subjective check-in input in the device-calendar seven-day window, the upcoming Program week, and prior completed proposal-marked deloads. A fallback score stored at workout start is not counted as an observed readiness day.
2. A minimized model view removes raw program, workout, exercise, day, and slot IDs; raw set history; exact workout timestamps; adaptation-readiness dates and the adaptation's per-day state sequence; account contact information; and fields the Coach does not need. Calendar dates remain in summarized recent workouts and PR signals. The adaptation view contains only display-safe lift names/reasons, recorded-day/red-day counts, a bounded trigger enum and label, and the fixed next-workout prescription. It can include at most three locally validated proposal summaries identified only by opaque IDs shaped like `cp_0123456789abcdef`.
3. The authenticated Edge Function independently rebuilds that view from a fixed allowlist, bounds every string and number, accepts a deload only with the known trigger and exact next-workout `-40%` volume / `-10%` intensity / drop-top-sets prescription, validates each proposal's opaque ID/kind/summary, rejects conflicting duplicate IDs, replaces protected custom labels, and ignores client-supplied constraints.
4. Only an in-scope fitness request reaches the configured model provider. The request contains the minimized context, at most six eligible prior turns, a small evidence list, and only proposal options relevant to the immediate next-workout question. OpenAI requests set `store: false`; other providers require separately verified controls.
5. The checked-in function expects prompt `2026-08-10.8` and strict schema `2`. These local expected values do not attest the version of a deployed Edge Function. The server permits only known evidence keys and an exact ID from the filtered proposal allowlist, rejects extra response fields, and replaces safety, privacy, secret, prompt-injection, and off-topic responses with fixed application copy. The mobile client repeats the output checks before display.

The function does not query conversation rows or another user's workout data. Authentication identifies the caller for access control and rate limiting; it does not make arbitrary client-supplied facts trustworthy, which is why the server allowlist and output checks remain required.

## Storage and retention

- Coach threads and messages are local-only SQLite records scoped by `user_id`. They are excluded from `SYNCED_TABLES` and the generic mutation queue.
- A user can permanently delete a thread and its messages from the Coach screen.
- Email addresses, phone-like identifiers, API-key-like values, JWT-like values, private-key headers, and explicit secret/private-data requests are replaced with `[Protected input omitted]` before local persistence. Their original text can remain visible in memory for the current screen session, but it is neither resent nor restored after reload.
- Safety, off-topic, privacy, secret, and prompt-injection turns get an empty `history_content`, so a later valid question cannot replay them to the model.
- A syntactically valid proposal ID can be retained inside a local assistant reply so the card can be reconstructed, but history is not action authority. The client must resolve it against the current proposal set, and malformed, protected, expired, or unoffered IDs become `null` or an expired card.
- A newly applied synced deload gets one bounded `workout_training_intents` row with intent `coach_deload`; a live row (`deleted_at is null`) marks the workout as a deload, while no live row means ordinary training and a synced tombstone may remain. Its versioned `plan_json` contains the exact engine base/resume snapshot needed for cross-device active-workout recovery: Program-day/slot/exercise references, session name/week/readiness band, engine-authored per-slot progression state, set indices/kinds, rep or time targets, rest, plate-rounded loads, and deterministic engine notes/kind. Atrium strips the opaque proposal ID; the snapshot contains no workout/event timestamps, chat, or model output and is not added to provider context. The row itself retains `updated_at` and optional `deleted_at` sync/tombstone metadata. RLS permits the row only for the authenticated owner of its parent workout. An early schema-v12 development marker converted from the retired workout column may retain `plan_json = null`; it still excludes the workout from progression evidence, but cannot reconstruct a missing draft and therefore fails closed. Completed deload sets still sync and remain in history and analytics, while the separate table leaves the legacy `workouts` row shape unchanged.
- The rate limiter stores a generated event ID, authenticated Supabase user ID, and request timestamp. It stores no prompt, reply, training field, or model context, and table/function access is revoked from public, anonymous, and authenticated client roles.
- The Edge Function does not log prompt or response bodies in application code.

Local threads are not end-to-end encrypted by Atrium. Their protection currently depends on the iOS application sandbox, device security, and the eventual backup policy. Confirm device-backup behavior, deletion semantics, the selected provider's retention and training-use controls, and Supabase operational logs during production privacy review.

## One-workout action boundary

The model does not receive a general mutation tool. It can return only one exact opaque ID for an option the device already constructed and the server retained for that question. The answer cannot carry the ID in prose, and extra model-generated arguments invalidate the response. Safety and boundary replies always return `proposalId: null`.

The proposal card is review-only until the athlete presses **Apply & start workout**. The device then regenerates the adaptation signal and plan and revalidates the current active workout, active Program and exact next day/week, readiness, plan fingerprint, selected opaque option, deload trigger, and deterministic engine constraints. Red readiness, a disappeared trigger, or a changed plan fails closed. A different active workout blocks the proposal; an existing workout marked with the same proposal ID is resumed. Apply requests are serialized per user so duplicate or competing proposal IDs cannot create competing Coach workouts.

The successful action creates one local workout and one proposal-marked workout draft. A targeted volume reduction can remove only the final one or two eligible back-off sets while leaving at least one. An engine-triggered deload can target about 40% fewer working sets, plate-round loads about 10% lower, and remove top sets while retaining at least one working set for each movement that originally had working work. It preserves exercise/slot identity, rest periods, and the unmodified plan's next progression state. Previous logs, the persistent Program structure, and later sessions remain unchanged.

The final plan is rebuilt inside one local SQLite transaction. The workout row, any normal engine-authored program-slot state advances, their sync-queue entries, and the draft either all commit or all roll back. A failed draft write therefore does not leave an orphan workout, advanced slot state, or partial sync mutation. This normal progression bookkeeping is not a deload-authored Program change.

The durable `coach_deload` side-table marker keeps the completed workout visible
to the athlete while excluding its reduced sets from normal progression history
and stall evidence. This prevents lowered deload back-offs from being reused as
evidence for a normal load increase without deleting or hiding the real log.
For newly applied deloads, the sync queue orders workout → intent/snapshot →
sets without splitting the first two at a batch boundary. Migration `0006`
commits that recognized parent+marker pair through one idempotent RLS-enforced
RPC. Converted early-v12 markers can use ordinary single-row upserts instead.
The migration server-stamps every synced insert and update, and reads every
table through a database-time barrier and 500-row
composite keyset pages. Ordinary pulls replay a five-minute overlap; a cursor
ahead of database time forces a full historical backfill. A failed later page
does not advance the cursor. Only a still-unpushed local mutation can override
a pulled server row; a clean row cannot become immortal because its device
clock was ahead.
The plan snapshot is used only to resume an already-active deload when its local
draft is unavailable; it cannot authorize a new Coach action. Before use, the
client requires the resume plan to equal the exact engine transformation of its
base plan and binds the Program day, slot/exercise references, rules, rest, and
engine state to current local rows. Missing, malformed, tampered, or stale data
fails closed.

A completed proposal-marked deload counts only when the workout is ended and has completed non-warm-up work. It suppresses repeated acute stall/readiness deloads for the recent seven-day signal window and prevents another scheduled week-7 deload in the same Program block. This cooldown is computed locally and only the minimized result can enter provider context.

## Deterministic boundaries

Both the mobile app and Edge Function independently classify:

- urgent, injury/pain, medical-treatment, and extreme-restriction language
- attempts to reveal system instructions, credentials, tokens, environment values, or server configuration
- requests for another person's data
- prompt-injection and guardrail-bypass language
- clearly unrelated topics

Unknown topics fail closed. Only explicit fitness/training/recovery/closely related nutrition language and a narrow set of supported Coach shorthand can reach the model. Classifiers run in this order: safety, protected boundary, authenticated rate limit, model call, response schema validation, protected-output scan, and safety/boundary normalization.

## Abuse controls

Migration `0004_coach_security.sql` installs an authenticated-user limiter of eight live model calls per minute and 100 per rolling 24 hours. A per-user PostgreSQL advisory transaction lock prevents concurrent requests from racing the count-and-insert check. The RPC is executable only by `service_role`; the Edge Function passes the user ID from the verified bearer session and fails closed if the service credential or RPC is unavailable.

## Remaining production work

- Apply `0005_workout_training_intent.sql` and `0006_sync_pull_safety.sql` before releasing a schema-v12 client that queries the side table/RPCs, then verify RLS, atomic workout+intent visibility, complete paginated pulls, exact cross-device resume validation, fail-closed rejection, and round trip in staging.
- Keep production deload creation off until a server- or store-enforced minimum supported client version excludes schema-v11 syncing clients; that enforcement is not implemented yet. The only production opt-in syntax is `EXPO_PUBLIC_ATRIUM_ADAPTIVE_DELOAD_ENABLED=1`. Older clients ignore the new table safely, but they cannot interpret its marker and would otherwise treat pulled deload sets as normal progression evidence.
- Deploy the updated function and run the fictional-data staging gate against the locally expected prompt `2026-08-10.8` and schema `2`. Evaluator labels come from local constants and are not deployed-version attestation; verify and record the deployed function version separately with provider/model, pass rate, latency, and human-review findings.
- Complete a full integrated native re-QA pass and curate repository captures for the deload card, Apply/resume flow, and resulting workout. The prior iPhone 17 UI/fallback pass predates the synced side-table revision, while current native evidence proves only the schema-v12 SQLite migration. Existing checked-in proposal screenshots cover the earlier unchanged/volume-reduction path.
- Add more paraphrase, multilingual, obfuscation, encoding, indirect-injection, and false-positive cases. Regex classifiers are deliberately conservative and can still miss novel attacks.
- Obtain qualified fitness and clinical-safety review for advice and escalation copy.
- Complete privacy/legal review for health-adjacent data, every configured model provider and subprocessor, retention, training use, account deletion, device backups, and incident response.
- Add user-visible reporting and a server-side abuse-monitoring process that does not collect raw conversations by default.
- Re-verify Supabase grants/RLS, rate-limit behavior under concurrency, and cleanup/retention in a staging PostgreSQL project.
- Keep broader Program, multi-workout, exercise-substitution, load, and rep mutation unavailable until each action has its own bounded proposal schema, deterministic engine validation, stale/idempotence rules, explicit confirmation, and tool-level evaluations.
