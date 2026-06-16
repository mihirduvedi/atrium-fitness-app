import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

/**
 * Supabase client, or null when the app runs without a backend configured —
 * everything still works offline; the mutation queue just keeps accumulating
 * until a backend exists.
 *
 * The session persists in AsyncStorage. This matters for deferred-account
 * auth (Part G): the anonymous user minted at first launch must be the SAME
 * auth.users row on every later launch, or the device would orphan its data.
 *
 * Local dev: `npx supabase start` prints the URL + anon key; put them in
 * apps/mobile/.env as EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY.
 */
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          storage: Platform.OS === 'web' ? undefined : AsyncStorage,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      })
    : null;
