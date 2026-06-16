#!/usr/bin/env node
// Stage 6 verification against the LOCAL Supabase stack (npx supabase start):
// 1. anonymous sign-in mints a real auth.users row (no email/password)
// 2. the anonymous user can sync immediately: RLS-scoped insert + read-back
// 3. a second anonymous user cannot see the first user's rows
// Usage: node scripts/verify-anon-auth.mjs <API_URL> <ANON_KEY>
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const [url, anonKey] = process.argv.slice(2);
if (!url || !anonKey) {
  console.error('usage: node scripts/verify-anon-auth.mjs <API_URL> <ANON_KEY>');
  process.exit(2);
}

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};

const a = createClient(url, anonKey, { auth: { persistSession: false } });
const b = createClient(url, anonKey, { auth: { persistSession: false } });

// 1. anonymous sign-in at "first launch"
const { data: userA, error: eA } = await a.auth.signInAnonymously();
if (eA || !userA.user) fail(`anon sign-in A: ${eA?.message}`);
if (!userA.user.is_anonymous) fail('user A should be anonymous');
console.log(`ok: anonymous user A = ${userA.user.id}`);

// 2. sync works immediately: insert a workout keyed on a client UUID
const workoutId = randomUUID();
const now = new Date().toISOString();
const { error: insErr } = await a.from('workouts').upsert({
  id: workoutId,
  user_id: userA.user.id,
  started_at: now,
  readiness_at_start: 82,
  updated_at: now,
});
if (insErr) fail(`anon insert: ${insErr.message}`);
const { data: rows, error: readErr } = await a.from('workouts').select('id').eq('id', workoutId);
if (readErr || rows.length !== 1) fail(`anon read-back: ${readErr?.message ?? 'row missing'}`);
console.log('ok: anonymous user can write + read own rows through RLS');

// forged user_id must be rejected
const { error: forgeErr } = await a.from('workouts').insert({
  id: randomUUID(),
  user_id: randomUUID(), // someone else
  started_at: now,
  updated_at: now,
});
if (!forgeErr) fail('forged user_id insert was accepted');
console.log(`ok: forged user_id rejected (${forgeErr.code})`);

// 3. isolation between anonymous users
const { data: userB, error: eB } = await b.auth.signInAnonymously();
if (eB || !userB.user) fail(`anon sign-in B: ${eB?.message}`);
const { data: leaked } = await b.from('workouts').select('id').eq('id', workoutId);
if ((leaked ?? []).length !== 0) fail("user B can see user A's workout");
console.log('ok: second anonymous user cannot see the first user’s rows');

// catalog is readable by anonymous users (Today screen needs it after pull)
const { data: cat, error: catErr } = await b.from('exercises').select('id').limit(1);
if (catErr || cat.length !== 1) fail(`catalog read: ${catErr?.message}`);
console.log('ok: seeded exercise catalog readable');

// cleanup
await a.from('workouts').delete().eq('id', workoutId);
console.log('\nStage 6 server-side verification PASSED');
