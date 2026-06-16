import * as Apple from 'expo-apple-authentication';
import { Platform } from 'react-native';
import { supabase } from './supabase';

/**
 * Deferred-account auth (brief Part G). The app is fully usable anonymously:
 * Supabase anonymous sign-in at first launch so sync works immediately.
 * After the first completed workout, Summary offers Sign in with Apple,
 * which UPGRADES the anonymous user in place — same user_id, no data
 * migration. There is no email/password path.
 */

/**
 * Ensure a Supabase session exists. Returns the authenticated user id, or
 * null when offline / no backend configured (the caller falls back to a
 * local id and keeps queueing — see STATUS.md for the re-key gap).
 */
export async function signInAnonymouslyIfNeeded(knownUserId: string | null): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session) return sessionData.session.user.id;
    // an existing local user id means we already had an account once; signing
    // in anonymously again would mint a NEW user — prefer staying local
    if (knownUserId) return knownUserId;
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.user) return null;
    return data.user.id;
  } catch {
    return null; // offline first launch
  }
}

/**
 * Upgrade the anonymous user in place with Sign in with Apple. Links the
 * Apple identity to the SAME auth.users row, so every synced row keeps its
 * user_id. Requires expo-apple-authentication (native build, iOS only);
 * returns false in Expo Go / web / Android, where the button stays hidden.
 */
export async function upgradeWithApple(): Promise<{ ok: boolean; reason?: string }> {
  if (!supabase) return { ok: false, reason: 'no backend configured' };
  try {
    if (!(await Apple.isAvailableAsync())) return { ok: false, reason: 'Apple sign-in unavailable' };
    const credential = await Apple.signInAsync({
      requestedScopes: [Apple.AppleAuthenticationScope.FULL_NAME, Apple.AppleAuthenticationScope.EMAIL],
    });
    if (!credential.identityToken) return { ok: false, reason: 'no identity token' };

    const { data: before } = await supabase.auth.getUser();
    const anonId = before.user?.id;
    if (!anonId) return { ok: false, reason: 'no active session to upgrade' };

    // With an active anonymous session, GoTrue links a first-time Apple
    // identity to the CURRENT user (manual-linking flow) — the user_id must
    // not change. If the Apple ID was already bound to a different account,
    // the id WOULD change; treat that as failure and restore anonymity
    // rather than silently switching accounts (no data migration exists).
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
    });
    if (error) return { ok: false, reason: error.message };
    if (data.user && data.user.id !== anonId) {
      await supabase.auth.signOut();
      return { ok: false, reason: 'Apple ID already belongs to another account' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Whether this runtime can show the Apple upgrade CTA without crashing. */
export async function canUpgradeWithApple(): Promise<boolean> {
  if (!supabase || Platform.OS !== 'ios') return false;
  try {
    return await Apple.isAvailableAsync();
  } catch {
    return false;
  }
}

/** True when the current session is still anonymous (drives the Summary CTA). */
export async function isAnonymous(): Promise<boolean> {
  if (!supabase) return true;
  try {
    const { data } = await supabase.auth.getUser();
    return data.user ? !!data.user.is_anonymous : true;
  } catch {
    return true;
  }
}
