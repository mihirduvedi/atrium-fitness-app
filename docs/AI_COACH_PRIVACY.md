# AI Coach privacy and security boundary

This document records what the current Atrium Coach sends, stores, rejects, and still needs before production. It is an engineering boundary, not a claim of perfect confidentiality or medical safety.

## Data flow

1. The mobile app computes a context pack from the authenticated user's local profile, current program, completed workouts, personal-record signals, recovery state, and a deterministic preview of the next Program day.
2. A minimized model view removes raw program, workout, exercise, day, and slot IDs; exact workout timestamps; account contact information; and fields the Coach does not need. It can include at most three locally validated proposal summaries identified only by opaque IDs shaped like `cp_0123456789abcdef`.
3. The authenticated Edge Function independently rebuilds that view from a fixed allowlist, bounds every string and number, validates each proposal's opaque ID/kind/summary, rejects conflicting duplicate IDs, replaces protected custom labels, and ignores client-supplied constraints.
4. Only an in-scope fitness request reaches the configured model provider. The request contains the minimized context, at most six eligible prior turns, a small evidence list, and only proposal options relevant to the immediate next-workout question. OpenAI requests set `store: false`; other providers require separately verified controls.
5. The response must match prompt `2026-08-05.7` and strict schema `2`. The server permits only known evidence keys and an exact ID from the filtered proposal allowlist, rejects extra response fields, and replaces safety, privacy, secret, prompt-injection, and off-topic responses with fixed application copy. The mobile client repeats the output checks before display.

The function does not query conversation rows or another user's workout data. Authentication identifies the caller for access control and rate limiting; it does not make arbitrary client-supplied facts trustworthy, which is why the server allowlist and output checks remain required.

## Storage and retention

- Coach threads and messages are local-only SQLite records scoped by `user_id`. They are excluded from `SYNCED_TABLES` and the generic mutation queue.
- A user can permanently delete a thread and its messages from the Coach screen.
- Email addresses, phone-like identifiers, API-key-like values, JWT-like values, private-key headers, and explicit secret/private-data requests are replaced with `[Protected input omitted]` before local persistence. Their original text can remain visible in memory for the current screen session, but it is neither resent nor restored after reload.
- Safety, off-topic, privacy, secret, and prompt-injection turns get an empty `history_content`, so a later valid question cannot replay them to the model.
- A syntactically valid proposal ID can be retained inside a local assistant reply so the card can be reconstructed, but history is not action authority. The client must resolve it against the current proposal set, and malformed, protected, expired, or unoffered IDs become `null` or an expired card.
- The rate limiter stores only the authenticated Supabase user ID and request timestamp. It stores no prompt, reply, training field, or model context, and table/function access is revoked from public, anonymous, and authenticated client roles.
- The Edge Function does not log prompt or response bodies in application code.

Local threads are not end-to-end encrypted by Atrium. Their protection currently depends on the iOS application sandbox, device security, and the eventual backup policy. Confirm device-backup behavior, deletion semantics, the selected provider's retention and training-use controls, and Supabase operational logs during production privacy review.

## One-workout action boundary

The model does not receive a general mutation tool. It can return only one exact opaque ID for an option the device already constructed and the server retained for that question. The answer cannot carry the ID in prose, and extra model-generated arguments invalidate the response. Safety and boundary replies always return `proposalId: null`.

The proposal card is review-only until the athlete presses **Apply & start workout**. The device then revalidates the current active workout, readiness, next Program day, regenerated plan fingerprint, selected option, and deterministic engine constraints. Red readiness or a changed plan fails closed. A different active workout blocks the proposal; an existing workout marked with the same proposal ID is resumed. Apply requests are serialized per user so duplicate or competing proposal IDs cannot create competing Coach workouts.

The successful action creates one local workout and one proposal-marked workout draft. A volume reduction can remove only the final one or two eligible back-off sets while leaving at least one; warm-ups, top sets, loads, reps, exercise identity, untargeted work, previous logs, the Program, and later sessions remain unchanged. If the plan changes between preview and draft write, Atrium discards the newly opened workout and returns a stale result.

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

- Run the 35-case staging gate against the exact deployed model and prompt; retain model/prompt/schema versions, pass rate, latency, and human-review findings without copying production user data.
- Add more paraphrase, multilingual, obfuscation, encoding, indirect-injection, and false-positive cases. Regex classifiers are deliberately conservative and can still miss novel attacks.
- Obtain qualified fitness and clinical-safety review for advice and escalation copy.
- Complete privacy/legal review for health-adjacent data, every configured model provider and subprocessor, retention, training use, account deletion, device backups, and incident response.
- Add user-visible reporting and a server-side abuse-monitoring process that does not collect raw conversations by default.
- Re-verify Supabase grants/RLS, rate-limit behavior under concurrency, and cleanup/retention in a staging PostgreSQL project.
- Keep broader Program, multi-workout, exercise-substitution, load, and rep mutation unavailable until each action has its own bounded proposal schema, deterministic engine validation, stale/idempotence rules, explicit confirmation, and tool-level evaluations.
