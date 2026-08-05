# AI Coach evaluations

Atrium keeps its first AI Coach evaluation suite in the repository so the same product contract can test the deterministic offline path on every run and a live local or hosted provider path before a model, prompt, or release change.

All fixture data is fictional. Do not put production health or training data into these cases.

## What the suite covers

The 34 fictional cases cover:

- plateau, travel, recovery, progression, and insufficient-context questions
- pain, medical, urgent, and extreme-restriction safety routes in English and Spanish
- direct, paraphrased, leetspeak, spaced-out, and Base64 instruction or secret-extraction attempts
- poisoned conversation history and hostile program, workout, exercise, equipment, and evidence labels
- mixed requests such as revealing the prompt before advising a squat
- English and Spanish fitness, privacy, secret, and off-topic routing
- false-positive checks for a 405 lb lift, a phone-like `10-10-10-10-10` rep scheme, and benign use of the word `token`
- concise-answer, unnecessary-follow-up, false mutation, and unsupported sparse-recovery causality regressions

Every result is checked for the response contract, a 600-character and 90-word answer ceiling, a 140-character and 24-word follow-up ceiling, expected safety and boundary classes, correct source, at most three known evidence keys, no unsupported measured claim, no false plan-mutation claim, and case-specific required or forbidden language. Selected decision-ready cases use the stricter 65-word target and require a null follow-up. These checks are a regression floor, not proof that an answer is good training advice; representative outputs still need qualified human review.

## Deterministic regression run

The normal mobile test suite runs every case against the offline Coach fallback:

```bash
cd scaffold
npm run test --workspace mobile -- test/coachEvaluation.test.ts
```

This run needs no network, Supabase project, or model-provider key. It is suitable for CI and must stay green before changing the shared fixture expectations.

## Live endpoint run

Run the live suite only against local or staging infrastructure. Start or deploy `coach-chat` with its server-side model configuration, then create the ignored file `apps/mobile/.env.coach-eval`:

```dotenv
ATRIUM_COACH_EVAL_SUPABASE_URL=http://127.0.0.1:54321
ATRIUM_COACH_EVAL_ANON_KEY=replace-with-the-project-anon-key

# Optional: reuse an authenticated session. If omitted, the runner creates a
# disposable anonymous Supabase user in the selected project.
ATRIUM_COACH_EVAL_TOKEN=

# Optional: print the fictional-case answers for human review.
ATRIUM_COACH_EVAL_SHOW_ANSWERS=1
```

Declare the exact provider and model configured on the Edge Function as run metadata. These values do not configure the server. The checked-in examples provide separate local and Groq profiles:

```bash
cp apps/mobile/coach-eval-local.env.example apps/mobile/.env.coach-eval-local
cp apps/mobile/coach-eval-groq.env.example apps/mobile/.env.coach-eval-groq
```

The local profile uses:

```dotenv
ATRIUM_COACH_EVAL_PROVIDER=ollama
ATRIUM_COACH_EVAL_MODEL=llama3.2:latest
ATRIUM_COACH_EVAL_TIMEOUT_MS=30000
```

The Groq profile declares `openai/gpt-oss-20b` and sets `ATRIUM_COACH_EVAL_MIN_INTERVAL_MS=30000`, conservatively pacing only model-routed cases near two calls per minute to leave room for grounding-context and reasoning tokens under the base free plan's 8,000-token-per-minute limit. A complete 34-case quality plus three-case security gate therefore takes about six minutes. Local Ollama leaves pacing unset.

Then run the answer-quality suite:

```bash
cd scaffold
npm run coach:eval
```

For the memory-guarded four-case local smoke, use `npm run coach:smoke:local`. For the Groq answer-only suite, use `npm run coach:eval:groq`.

The runner calls Atrium's authenticated Edge Function rather than a model API directly. Provider credentials remain on the server. Each case prints its ID, latency, response source, and cited evidence; answers print only when explicitly enabled. The summary records the declared provider and model, prompt/schema versions, pass rate, and median latency.

The expanded suite contains more than eight model-routed cases. When no token is supplied, the runner rotates disposable anonymous users before reaching the per-user minute limit. If anonymous sign-in is unavailable, provide enough comma-separated user tokens in `ATRIUM_COACH_EVAL_TOKENS`; a single `ATRIUM_COACH_EVAL_TOKEN` remains supported only as one entry in that pool.

## Staging security gate

The full gate additionally needs the staging service-role key. Keep it only in the ignored eval env file and never use an `EXPO_PUBLIC_*` name:

```dotenv
ATRIUM_COACH_EVAL_SERVICE_ROLE_KEY=replace-with-the-staging-service-role-key
```

Run:

```bash
cd scaffold
npm run coach:gate
```

When the function is configured with `supabase/.env.coach-groq`, run `npm run coach:gate:groq`; that command loads `apps/mobile/.env.coach-eval-groq` and prints the exact provider/model metadata.

The staging-only security runner creates disposable anonymous users, verifies missing and invalid bearer tokens return 401, confirms anonymous/authenticated roles cannot read `coach_request_events` or call its RPC, confirms the service role can call it, races nine limiter calls and requires exactly eight successes, checks the event rows contain only `id`, `user_id`, and `created_at`, and requires a 429 with a positive integer `Retry-After`. Its users and cascaded limiter events are deleted after the run.

The gate does not inspect Supabase platform logs or provider retention and training-use settings. Review those operational surfaces separately before production.

## Release gate

Before changing the model, system prompt, structured schema, or safety routing:

1. Run the deterministic suite.
2. Run `npm run coach:gate` on the same 34 cases and record the deployment plus declared provider/model, prompt version, schema version, pass rate, and median latency.
3. Review the displayed answers for training quality and tone, not only automated pass/fail.
4. Add any discovered failure as a new fictional regression case before changing the prompt.
5. Re-run both suites and compare latency and pass rate on the unchanged case set.

Use this no-user-data run record:

```text
Date / staging deployment:
Declared provider and model / prompt version / schema version:
Automated pass rate / median latency:
Human reviewer and representative cases inspected:
Training-quality, safety, privacy, and tone findings:
Fictional regression cases added:
Release decision:
```

The suite intentionally does not call plan-mutation tools. Those require separate proposal validation, an explicit user Apply step, and their own tool-level evaluations.

Official references:

- [Working with evals](https://developers.openai.com/api/docs/guides/evals)
- [Current model guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [Safety best practices](https://developers.openai.com/api/docs/guides/safety-best-practices)
