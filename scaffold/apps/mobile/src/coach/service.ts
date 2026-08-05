import { supabase } from '../supabase';
import type { CoachContextPack } from './context';
import {
  compactCoachHistory,
  fallbackCoachReply,
  normalizeCoachMessage,
  parseCoachReply,
  preflightCoachReply,
  type CoachHistoryItem,
  type CoachReply,
} from './chat';

function functionStatus(error: unknown) {
  if (!error || typeof error !== 'object' || !('context' in error)) return null;
  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== 'object' || !('status' in context)) return null;
  return typeof (context as { status?: unknown }).status === 'number'
    ? (context as { status: number }).status
    : null;
}

export async function askCoach(
  pack: CoachContextPack,
  message: string,
  history: CoachHistoryItem[] = [],
): Promise<CoachReply> {
  const normalized = normalizeCoachMessage(message);
  const preflight = preflightCoachReply(normalized);
  if (preflight) return preflight;
  const client = supabase;
  if (!client) return fallbackCoachReply(normalized, pack);

  try {
    const body = {
      message: normalized,
      history: compactCoachHistory(history),
      context: pack.modelContext,
      evidence: pack.evidence,
    };
    const invoke = () => client.functions.invoke('coach-chat', { timeout: 20_000, body });
    let result = await invoke();
    if (result.error && process.env.NODE_ENV !== 'production' && functionStatus(result.error) === 401) {
      await client.auth.signOut({ scope: 'local' }).catch(() => {});
      const { error: signInError } = await client.auth.signInAnonymously();
      if (!signInError) result = await invoke();
    }
    if (result.error) return fallbackCoachReply(normalized, pack);
    return parseCoachReply(result.data, pack) ?? fallbackCoachReply(normalized, pack);
  } catch {
    return fallbackCoachReply(normalized, pack);
  }
}
