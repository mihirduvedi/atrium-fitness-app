import { randomUUID } from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { migrate, type SqlDb } from './db/client';
import { getMeta, seedExerciseCatalog, setMeta } from './db/queries';
import { signInAnonymouslyIfNeeded } from './auth';
import { createSubscriptionClient, type SubscriptionClient } from './subscriptions/revenueCat';
import {
  unconfiguredSubscription,
  type SubscriptionActionResult,
  type SubscriptionSnapshot,
} from './subscriptions/subscription';
import { SyncEngine } from './sync/engine';
import { createSupabaseRemote } from './sync/supabaseRemote';
import { supabase } from './supabase';

interface CoreAppServices {
  db: SqlDb;
  userId: string;
  deviceId: string;
  /** null when no backend is configured — the app is fully usable offline. */
  sync: SyncEngine | null;
  newId: () => string;
  pendingWorkoutMovement: PendingWorkoutMovement | null;
  queueWorkoutMovement: (movement: PendingWorkoutMovement) => void;
  clearPendingWorkoutMovement: (id: string) => void;
}

export interface AppServices extends CoreAppServices {
  subscription: SubscriptionSnapshot;
  refreshSubscription: () => Promise<SubscriptionSnapshot>;
  purchaseSubscription: (packageId: string) => Promise<SubscriptionActionResult>;
  restoreSubscription: () => Promise<SubscriptionActionResult>;
  manageSubscription: () => Promise<SubscriptionActionResult>;
}

export interface PendingWorkoutMovement {
  id: string;
  programDayId: string;
  slotId: string;
  exerciseId: string;
  exerciseName: string;
  pattern: string;
  equipment: string;
  sets: number;
  reps: number;
  scope: 'session' | 'program';
}

const Ctx = createContext<AppServices | null>(null);

export function useApp(): AppServices {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

async function bootstrap(): Promise<CoreAppServices> {
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

  return {
    db,
    userId,
    deviceId,
    sync,
    newId: randomUUID,
    pendingWorkoutMovement: null,
    queueWorkoutMovement: () => {},
    clearPendingWorkoutMovement: () => {},
  };
}

let bootstrapPromise: Promise<CoreAppServices> | null = null;

function loadServices(): Promise<CoreAppServices> {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrap().catch((e) => {
      bootstrapPromise = null;
      throw e;
    });
  }
  return bootstrapPromise;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [services, setServices] = useState<CoreAppServices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingWorkoutMovement, setPendingWorkoutMovement] = useState<PendingWorkoutMovement | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionSnapshot>(() => unconfiguredSubscription());
  const subscriptionClient = useRef<SubscriptionClient | null>(null);

  useEffect(() => {
    loadServices().then(setServices, (e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!services) return;
    let live = true;
    const client = createSubscriptionClient();
    subscriptionClient.current = client;
    setSubscription(client.initialSnapshot);
    client.initialize(services.userId, (next) => {
      if (live) setSubscription(next);
    }).catch((e) => {
      if (live) setSubscription({
        ...client.initialSnapshot,
        status: 'error',
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    });
    return () => {
      live = false;
      client.dispose();
      if (subscriptionClient.current === client) subscriptionClient.current = null;
    };
  }, [services]);

  const refreshSubscription = useCallback(async () => {
    const next = await subscriptionClient.current?.refresh();
    if (!next) return unconfiguredSubscription();
    setSubscription(next);
    return next;
  }, []);

  const purchaseSubscription = useCallback(async (packageId: string) => {
    const result = await subscriptionClient.current?.purchase(packageId) ?? {
      outcome: 'unavailable' as const,
      message: 'Subscriptions are unavailable in this build.',
    };
    if (result.snapshot) setSubscription(result.snapshot);
    return result;
  }, []);

  const restoreSubscription = useCallback(async () => {
    const result = await subscriptionClient.current?.restore() ?? {
      outcome: 'unavailable' as const,
      message: 'Subscriptions are unavailable in this build.',
    };
    if (result.snapshot) setSubscription(result.snapshot);
    return result;
  }, []);

  const manageSubscription = useCallback(async () => {
    const result = await subscriptionClient.current?.openManagement() ?? {
      outcome: 'unavailable' as const,
      message: 'There is no active store subscription to manage.',
    };
    if (result.snapshot) setSubscription(result.snapshot);
    return result;
  }, []);

  if (error) throw new Error(error);
  if (!services) return null; // splash stays up
  return (
    <Ctx.Provider
      value={{
        ...services,
        subscription,
        refreshSubscription,
        purchaseSubscription,
        restoreSubscription,
        manageSubscription,
        pendingWorkoutMovement,
        queueWorkoutMovement: setPendingWorkoutMovement,
        clearPendingWorkoutMovement: (id: string) => {
          setPendingWorkoutMovement((current) => (current?.id === id ? null : current));
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
