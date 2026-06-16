import { randomUUID } from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { migrate, type SqlDb } from './db/client';
import { getMeta, seedExerciseCatalog, setMeta } from './db/queries';
import { signInAnonymouslyIfNeeded } from './auth';
import { SyncEngine } from './sync/engine';
import { createSupabaseRemote } from './sync/supabaseRemote';
import { supabase } from './supabase';

export interface AppServices {
  db: SqlDb;
  userId: string;
  deviceId: string;
  /** null when no backend is configured — the app is fully usable offline. */
  sync: SyncEngine | null;
  newId: () => string;
}

const Ctx = createContext<AppServices | null>(null);

export function useApp(): AppServices {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

async function bootstrap(): Promise<AppServices> {
  const raw = await SQLite.openDatabaseAsync('atrium.db');
  const db: SqlDb = raw;
  await migrate(db);
  await seedExerciseCatalog(db);

  let deviceId = await getMeta(db, 'device_id');
  if (!deviceId) {
    deviceId = randomUUID();
    await setMeta(db, 'device_id', deviceId);
  }

  // Deferred-account auth (Stage 6): anonymous sign-in at first launch so
  // sync works immediately. Falls back to a local id when offline/unconfigured.
  let userId = await getMeta(db, 'user_id');
  const authedId = await signInAnonymouslyIfNeeded(userId);
  if (authedId && authedId !== userId) {
    userId = authedId;
    await setMeta(db, 'user_id', userId);
  }
  if (!userId) {
    userId = randomUUID(); // offline-only fallback; STATUS.md documents the re-key gap
    await setMeta(db, 'user_id', userId);
  }

  const sync = supabase && authedId ? new SyncEngine(db, createSupabaseRemote(supabase), userId, deviceId) : null;
  // fire-and-forget initial sync; failures back off and the queue is durable
  sync?.sync().catch(() => {});

  return { db, userId, deviceId, sync, newId: randomUUID };
}

let bootstrapPromise: Promise<AppServices> | null = null;

function loadServices(): Promise<AppServices> {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrap().catch((e) => {
      bootstrapPromise = null;
      throw e;
    });
  }
  return bootstrapPromise;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [services, setServices] = useState<AppServices | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadServices().then(setServices, (e) => setError(String(e)));
  }, []);

  if (error) throw new Error(error);
  if (!services) return null; // splash stays up
  return <Ctx.Provider value={services}>{children}</Ctx.Provider>;
}
