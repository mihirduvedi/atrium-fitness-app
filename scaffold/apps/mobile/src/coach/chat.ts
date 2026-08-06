import type { CoachContextPack, CoachEvidenceKey } from './context';
import { preferredOfflineProposalId } from './proposals';

export const MAX_COACH_MESSAGE_CHARS = 600;
export const MAX_COACH_HISTORY_MESSAGES = 6;
export const MAX_COACH_ANSWER_CHARS = 600;
export const MAX_COACH_FOLLOW_UP_CHARS = 140;

export type CoachSafetyClass = 'standard' | 'pain' | 'medical' | 'nutrition' | 'urgent';
export type CoachBoundaryClass = 'fitness' | 'off_topic' | 'privacy' | 'secrets' | 'prompt_injection';
export type CoachReplySource = 'model' | 'offline' | 'safety' | 'boundary';

export interface CoachHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface CoachReply {
  answer: string;
  evidenceKeys: CoachEvidenceKey[];
  followUp: string | null;
  safetyClass: CoachSafetyClass;
  boundaryClass: CoachBoundaryClass;
  source: CoachReplySource;
  notice: string | null;
  proposalId: string | null;
}

const SAFETY_CLASSES = new Set<CoachSafetyClass>(['standard', 'pain', 'medical', 'nutrition', 'urgent']);
const BOUNDARY_CLASSES = new Set<CoachBoundaryClass>(['fitness', 'off_topic', 'privacy', 'secrets', 'prompt_injection']);

const URGENT_PATTERN = /\b(chest pain|cannot breathe|can't breathe|passed out|fainted|severe bleeding|suicid(?:e|al)|kill myself|dolor de pecho|no puedo respirar|me desmay[eé]|sangrado (?:grave|severo)|suicid(?:io|arme))\b/i;
const PAIN_PATTERN = /\b(pain|painful|hurt|hurts|hurting|injur(?:y|ed)|swollen|sharp ache|torn|sprain(?:ed)?|dolor|duele|lesi[oó]n|lesionado|hinchado|punzada|desgarro|esguince)\b/i;
const MEDICAL_PATTERN = /\b(diagnos(?:e|is)|medication|prescription|blood pressure|heart condition|medical advice|treat(?:ment)?|diagn[oó]stic(?:o|ar)|medicamento|receta|presi[oó]n arterial|afecci[oó]n card[ií]aca|consejo m[eé]dico|tratamiento)\b/i;
const NUTRITION_PATTERN = /\b(starve|stop eating|purge|vomit|extreme calorie|under 1[02]00 calories|eating disorder|dejar de comer|matarme de hambre|purgar|vomitar|calor[ií]as extremas|trastorno alimentario)\b/i;
const SECRET_PATTERN = /(?:\b(?:show|reveal|print|display|give|tell|dump|expose|repeat|leak|muestra|revela|imprime|dame|dime|vuelca|exp[oó]n|repite|filtra)\b.{0,80}\b(?:system prompt|developer message|hidden instructions?|api keys?|secret keys?|passwords?|access tokens?|bearer tokens?|environment variables?|\.env|server config(?:uration)?|prompt del sistema|mensaje del desarrollador|instrucciones ocultas?|claves? api|claves? secretas?|contrase[nñ]as?|tokens? de acceso|variables? de entorno|configuraci[oó]n del servidor)\b)|(?:\b(?:system prompt|developer message|hidden instructions?|api keys?|secret keys?|passwords?|access tokens?|bearer tokens?|environment variables?|\.env|server config(?:uration)?|prompt del sistema|mensaje del desarrollador|instrucciones ocultas?|claves? api|claves? secretas?|contrase[nñ]as?|tokens? de acceso|variables? de entorno|configuraci[oó]n del servidor)\b.{0,80}\b(?:show|reveal|print|display|give|tell|dump|expose|repeat|leak|muestra|revela|imprime|dame|dime|vuelca|exp[oó]n|repite|filtra)\b)/i;
const PRIVACY_PATTERN = /(?:\b(?:show|reveal|give|tell|list|dump|expose|find|muestra|mu[eé]strame|revela|dame|dime|lista|vuelca|encuentra)\b.{0,80}\b(?:(?:another|other|all|someone else's)\s+(?:users?|athletes?|people|members?)|(?:otros?|todas?|alguien m[aá]s)\s+(?:usuarios?|atletas?|personas?|miembros?))\b)|(?:\b(?:(?:another|other|all|someone else's)\s+(?:users?|athletes?|people|members?)|(?:otros?|todas?|alguien m[aá]s)\s+(?:usuarios?|atletas?|personas?|miembros?))\b.{0,80}\b(?:data|records?|workouts?|emails?|phone numbers?|addresses?|private|personal|datos|registros?|entrenamientos?|correos?|tel[eé]fonos?|direcciones?|privad[oa]s?|personales?)\b)/i;
const INJECTION_PATTERN = /\b(?:ignore|disregard|override|bypass)\b.{0,60}\b(?:previous|above|system|developer|instructions?|rules?|guardrails?)\b|\b(?:jailbreak|act as an? unrestricted|pretend you have no rules)\b|\b(?:ignora|omite|anula|desobedece|salta)\b.{0,60}\b(?:anteriores?|previas?|sistema|desarrollador|instrucciones?|reglas?|protecciones?)\b|\b(?:sin restricciones|finge que no tienes reglas)\b/i;
const FITNESS_PATTERN = /\b(workouts?|training|exercise|lift(?:ing)?|bench|squat(?:s|ted|ting)?|deadlift|press|row|run(?:ning)?|cardio|conditioning|recovery|recover(?:ed|ing)?|sleep|readiness|nutrition|calories?|protein|gym|sets?|reps?|weight|soreness|fatigue|program|plan|strength|muscle|mobility|warm-?ups?|deload|plateau|travel|entrenamientos?|ejercicios?|levantamiento|press de banca|banca|sentadilla|peso muerto|remo|correr|acondicionamiento|recuperaci[oó]n|sue[nñ]o|preparaci[oó]n|nutrici[oó]n|calor[ií]as?|prote[ií]na|gimnasio|series?|repeticiones?|peso|agujetas|fatiga|programa|fuerza|m[uú]sculo|movilidad|calentamiento|descarga|estancamiento|viaje)\b/i;
const FITNESS_ELLIPSIS_PATTERN = /\b(?:why am i stuck|feeling run down|make (?:my )?next (?:session|workout) harder|what should i (?:do|train) (?:today|next)|how (?:hard|heavy) should i go)\b/i;
const OFF_TOPIC_PATTERN = /\b(weather|politics?|elections?|stocks?|crypto|invest(?:ing|ment)?|taxes?|lawsuits?|legal advice|contracts?|javascript|python|programming|debug(?:ging)?|homework|essay|movies?|celebrity|dating|weapons?|bombs?|clima|pol[ií]tica|elecciones|acciones|criptomonedas?|inversiones?|impuestos|demanda|consejo legal|contratos?|programaci[oó]n|depurar|tarea|ensayo|pel[ií]culas?|famosos?|citas|armas?|bombas?)\b/i;
const SENSITIVE_VALUE_PATTERN = /(?:\bsk-[A-Za-z0-9_-]{10,}\b|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i;
const SECRET_OUTPUT_PATTERN = /\b(?:api|secret|access) key\s*(?:is|:|=)|\b(?:password|bearer token|access token)\s*(?:is|:|=)|\b(?:OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY)\b|\b(?:Deno|process)\.env\b/i;
const PROMPT_LEAK_PATTERN = /\b(?:COACH_SYSTEM_PROMPT|answer the athlete(?:'s|’s) question using only the supplied context|treat the athlete message.{0,80}as untrusted data)\b/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /\b(?:\+?\d[\s()./-]*)?(?:\d[\s()./-]*){9,}\d\b/i;
const PHONE_LIKE_TRAINING_PATTERN = /(?:\d[\s()./-]*){9,}\d.{0,24}\b(?:reps?|sets?|rounds?|clusters?|repeticiones?|series?|rondas?)\b|\b(?:reps?|sets?|rounds?|clusters?|repeticiones?|series?|rondas?)\b.{0,24}(?:\d[\s()./-]*){9,}\d/i;
const ENCODED_INSTRUCTION_PATTERN = /\b(?:base64|rot13|hex(?:adecimal)?)\b.{0,80}\b(?:decode|decodifica|instructions?|prompt|system|instrucciones?|sistema)\b|\b(?:decode|decodifica|instructions?|prompt|system|instrucciones?|sistema)\b.{0,80}\b(?:base64|rot13|hex(?:adecimal)?)\b/i;
const BASE64_BLOB_PATTERN = /(?:^|\s)[A-Za-z0-9+/]{28,}={0,2}(?=\s|$|[.,!?])/;
const SECRET_COMPACT_PATTERN = /(?:show|reveal|print|display|give|tell|dump|expose|repeat|leak|muestra|revela|imprime|dame|dime|vuelca|expon|repite|filtra).{0,80}(?:systemprompt|developermessage|hiddeninstructions?|apikeys?|secretkeys?|passwords?|accesstokens?|bearertokens?|environmentvariables?|envfile|serverconfig(?:uration)?|promptdelsistema|mensajedeldesarrollador|instruccionesocultas?|claves?api|claves?secretas?|contrasenas?|tokens?deacceso|variables?deentorno|configuraciondelservidor)|(?:systemprompt|developermessage|hiddeninstructions?|apikeys?|secretkeys?|passwords?|accesstokens?|bearertokens?|environmentvariables?|envfile|serverconfig(?:uration)?|promptdelsistema|mensajedeldesarrollador|instruccionesocultas?|claves?api|claves?secretas?|contrasenas?|tokens?deacceso|variables?deentorno|configuraciondelservidor).{0,80}(?:show|reveal|print|display|give|tell|dump|expose|repeat|leak|muestra|revela|imprime|dame|dime|vuelca|expon|repite|filtra)/i;
const INJECTION_COMPACT_PATTERN = /(?:ignore|disregard|override|bypass).{0,60}(?:previous|above|system|developer|instructions?|rules?|guardrails?)|(?:ignora|omite|anula|desobedece|salta).{0,60}(?:anteriores?|previas?|sistema|desarrollador|instrucciones?|reglas?|protecciones?)/i;

function deobfuscateSecurityText(message: string) {
  const leet: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };
  return message
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[013457@$]/g, (character) => leet[character] ?? character)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function containsPii(message: string) {
  if (EMAIL_PATTERN.test(message)) return true;
  return PHONE_PATTERN.test(message) && !PHONE_LIKE_TRAINING_PATTERN.test(message);
}

function containsSecretRequest(message: string) {
  const normalized = deobfuscateSecurityText(message);
  const compact = normalized.replace(/\s+/g, '');
  return SECRET_PATTERN.test(message) || SECRET_PATTERN.test(normalized) || SECRET_COMPACT_PATTERN.test(compact);
}

function containsPromptInjection(message: string) {
  const normalized = deobfuscateSecurityText(message);
  const compact = normalized.replace(/\s+/g, '');
  return INJECTION_PATTERN.test(message)
    || INJECTION_PATTERN.test(normalized)
    || INJECTION_COMPACT_PATTERN.test(compact)
    || ENCODED_INSTRUCTION_PATTERN.test(message)
    || BASE64_BLOB_PATTERN.test(message);
}

function containsProtectedCoachText(message: string) {
  return SENSITIVE_VALUE_PATTERN.test(message)
    || containsPii(message)
    || containsSecretRequest(message)
    || PRIVACY_PATTERN.test(message)
    || containsPromptInjection(message);
}

export function normalizeCoachMessage(message: string): string {
  return message.trim().replace(/\s+/g, ' ').slice(0, MAX_COACH_MESSAGE_CHARS);
}

export function compactCoachReplyText(message: string, maxChars: number): string {
  const normalized = message.trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxChars) return normalized;
  const prefix = normalized.slice(0, Math.max(1, maxChars - 1));
  const atWordBoundary = prefix.replace(/\s+\S*$/, '').trimEnd();
  return `${atWordBoundary || prefix}…`;
}

export function classifyCoachSafety(message: string): CoachSafetyClass {
  if (URGENT_PATTERN.test(message)) return 'urgent';
  if (NUTRITION_PATTERN.test(message)) return 'nutrition';
  if (PAIN_PATTERN.test(message)) return 'pain';
  if (MEDICAL_PATTERN.test(message)) return 'medical';
  return 'standard';
}

function safetyReplyForClass(safetyClass: Exclude<CoachSafetyClass, 'standard'>): CoachReply {
  if (safetyClass === 'urgent') {
    return {
      answer: 'Stop training and get immediate help. If you may be in danger or the symptoms are severe or sudden, contact local emergency services now.',
      evidenceKeys: [],
      followUp: null,
      safetyClass,
      boundaryClass: 'fitness',
      source: 'safety',
      notice: 'Atrium cannot assess an emergency.',
      proposalId: null,
    };
  }
  if (safetyClass === 'nutrition') {
    return {
      answer: 'I cannot help with extreme restriction or purging. Pause the nutrition target and talk with a qualified clinician or eating-disorder professional who can support you safely.',
      evidenceKeys: [],
      followUp: 'I can still help you review training consistency without setting a restrictive food target.',
      safetyClass,
      boundaryClass: 'fitness',
      source: 'safety',
      notice: 'Safety response · no model call made',
      proposalId: null,
    };
  }
  if (safetyClass === 'pain') {
    return {
      answer: 'I cannot diagnose or treat an injury. Stop the movement that causes pain and get guidance from a qualified clinician before loading it again.',
      evidenceKeys: [],
      followUp: 'If you are cleared to train, I can help you review unaffected sessions and your program schedule.',
      safetyClass,
      boundaryClass: 'fitness',
      source: 'safety',
      notice: 'Safety response · no model call made',
      proposalId: null,
    };
  }
  return {
    answer: 'I cannot diagnose a condition or recommend medical treatment. A qualified clinician can evaluate that safely.',
    evidenceKeys: [],
    followUp: 'I can help summarize what your training log shows without making a medical claim.',
    safetyClass,
    boundaryClass: 'fitness',
    source: 'safety',
    notice: 'Safety response · no model call made',
    proposalId: null,
  };
}

export function safetyCoachReply(message: string): CoachReply | null {
  const safetyClass = classifyCoachSafety(message);
  return safetyClass === 'standard' ? null : safetyReplyForClass(safetyClass);
}

export function classifyCoachBoundary(message: string): CoachBoundaryClass {
  if (SENSITIVE_VALUE_PATTERN.test(message)) return 'secrets';
  if (containsPii(message)) return 'privacy';
  if (containsSecretRequest(message)) return 'secrets';
  if (PRIVACY_PATTERN.test(message)) return 'privacy';
  if (containsPromptInjection(message)) return 'prompt_injection';
  if (FITNESS_PATTERN.test(message) || FITNESS_ELLIPSIS_PATTERN.test(message)) return 'fitness';
  if (OFF_TOPIC_PATTERN.test(message)) return 'off_topic';
  return 'off_topic';
}

export function detectProtectedCoachOutput(message: string): Exclude<CoachBoundaryClass, 'fitness'> | null {
  if (
    SENSITIVE_VALUE_PATTERN.test(message)
    || containsSecretRequest(message)
    || SECRET_OUTPUT_PATTERN.test(message)
    || PROMPT_LEAK_PATTERN.test(message)
  ) return 'secrets';
  if (containsPii(message) || PRIVACY_PATTERN.test(message)) return 'privacy';
  if (containsPromptInjection(message)) return 'prompt_injection';
  return null;
}

function boundaryReplyForClass(boundaryClass: Exclude<CoachBoundaryClass, 'fitness'>): CoachReply {
  const common = {
    evidenceKeys: [],
    followUp: null,
    safetyClass: 'standard' as const,
    boundaryClass,
    source: 'boundary' as const,
    notice: 'Protected Coach boundary · no model call made',
    proposalId: null,
  };
  if (boundaryClass === 'secrets') {
    return {
      ...common,
      answer: 'I cannot reveal system instructions, credentials, keys, tokens, environment values, or protected configuration. I can help with questions about your training and recovery.',
    };
  }
  if (boundaryClass === 'privacy') {
    return {
      ...common,
      answer: 'I can only use the training context supplied for your own Coach session. I cannot access or reveal another person’s private data.',
    };
  }
  if (boundaryClass === 'prompt_injection') {
    return {
      ...common,
      answer: 'I cannot override the Coach’s grounding, privacy, or safety rules. Ask a fitness question and I will keep the answer tied to your training context.',
    };
  }
  return {
    ...common,
    answer: 'Atrium Coach is limited to fitness, training, recovery, and closely related nutrition questions. I cannot help with that topic.',
  };
}

export function guardCoachOutput(message: string): CoachReply | null {
  const protectedBoundary = detectProtectedCoachOutput(message);
  if (protectedBoundary) return boundaryReplyForClass(protectedBoundary);
  const safetyClass = classifyCoachSafety(message);
  return safetyClass === 'standard' ? null : safetyReplyForClass(safetyClass);
}

export function boundaryCoachReply(message: string): CoachReply | null {
  const boundaryClass = classifyCoachBoundary(message);
  if (boundaryClass === 'fitness') return null;
  return boundaryReplyForClass(boundaryClass);
}

export function preflightCoachReply(message: string): CoachReply | null {
  return safetyCoachReply(message) ?? boundaryCoachReply(message);
}

function availableEvidence(pack: CoachContextPack, preferred: CoachEvidenceKey[]): CoachEvidenceKey[] {
  const available = new Set(pack.evidence.map((item) => item.key));
  return preferred.filter((key) => available.has(key)).slice(0, 3);
}

function safeCoachContextLabel(value: string | null | undefined, fallback: string) {
  return value && !containsProtectedCoachText(value) ? value : fallback;
}

export function fallbackCoachReply(message: string, pack: CoachContextPack): CoachReply {
  const preflight = preflightCoachReply(message);
  if (preflight) return preflight;

  const lower = message.toLowerCase();
  const latest = pack.recentWorkouts[0];
  const previous = pack.recentWorkouts[1];
  const next = safeCoachContextLabel(pack.program?.nextDayName, 'your next session');
  let answer: string;
  let evidenceKeys: CoachEvidenceKey[];
  let followUp: string | null = null;
  const asksForTodaysWorkout = (
    /\b(?:what|which)\s+(?:workout|session)\s+should\s+i\s+(?:do|train)\b/.test(lower)
    || /\bwhat\s+should\s+i\s+(?:do|train)\s+today\b/.test(lower)
    || (/\b(?:workout|session)\b/.test(lower) && /\breadiness\b/.test(lower))
  );

  if (asksForTodaysWorkout) {
    const plannedSession = pack.program?.nextDayName
      ? safeCoachContextLabel(pack.program.nextDayName, 'your next planned session')
      : null;
    const readinessTitle = safeCoachContextLabel(pack.readiness.title, pack.readiness.readiness);
    const readinessSummary = `${pack.readiness.score} (${readinessTitle})`;
    if (!plannedSession) {
      answer = `Your readiness is ${readinessSummary}, but the active plan does not identify the next workout. I cannot choose one without guessing.`;
    } else if (pack.readiness.readiness === 'red') {
      answer = `Make today a recovery day instead of ${plannedSession}. Your readiness is ${readinessSummary}, so do not force working sets; keep activity light and return to the planned session when readiness improves.`;
    } else if (pack.readiness.readiness === 'yellow') {
      answer = `Do ${plannedSession} today, but keep it conservative. Your readiness is ${readinessSummary}; keep the programmed movements and rep ranges, and reduce load within the range or trim back-off work if warm-ups feel unusually slow.`;
    } else {
      answer = `Do ${plannedSession} today. Your readiness is ${readinessSummary}, which supports the programmed session. Use your normal warm-ups and stay inside the prescribed load and rep ranges.`;
    }
    evidenceKeys = availableEvidence(pack, ['next_session', 'recovery']);
  } else if (/\b(stuck|plateau|stall)\b/.test(lower)) {
    answer = pack.prSignals[0]
      ? `${safeCoachContextLabel(pack.prSignals[0].exerciseName, 'That exercise')} still has a recent ${safeCoachContextLabel(pack.prSignals[0].label, 'performance').toLowerCase()} signal at ${safeCoachContextLabel(pack.prSignals[0].displayValue, 'the logged value')}, so the log does not prove a plateau yet. Keep the next two sessions inside the programmed range before changing the exercise.`
      : 'The log does not have enough repeated completed sessions to call a plateau yet. Keep recording actual reps and load so the trend can separate one rough day from a real stall.';
    evidenceKeys = availableEvidence(pack, ['latest_pr', 'current_week']);
  } else if (/\b(travel(?:ing)?|hotel|away)\b/.test(lower)) {
    answer = `Keep ${next} as the training target and substitute only for equipment you cannot access. Preserve the movement pattern and programmed set and rep range rather than inventing a new week.`;
    evidenceKeys = availableEvidence(pack, ['next_session', 'profile']);
  } else if (/\b(tired|fatigue|fatigued|run down|exhausted|recovery)\b/.test(lower)) {
    const volumeRose = !!latest && !!previous && latest.volume > previous.volume;
    answer = volumeRose
      ? 'Your latest logged session carried more volume than the one before it. Keep the main movement, use today’s readiness honestly, and trim a back-off set if warm-ups move unusually slowly.'
      : 'Use today’s readiness honestly and keep the goal to preserving the movement pattern, not forcing a PR. The log does not support an aggressive increase right now.';
    evidenceKeys = availableEvidence(pack, ['recovery', 'last_workout']);
  } else if (/\b(harder|increase|heavier|add weight|progress)\b/.test(lower)) {
    answer = `I would not override the progression engine for ${next}. If warm-ups move well, earn the increase through reps inside the programmed range; load changes should stay within the engine rules.`;
    evidenceKeys = availableEvidence(pack, ['next_session', 'recovery']);
  } else {
    answer = latest
      ? `Your latest completed session was ${safeCoachContextLabel(latest.dayName, 'a workout')} with ${latest.sets} working sets. Ask about a plateau, recovery, travel, or the next session and I will keep the answer tied to the log.`
      : 'Complete and log a workout first. I need real sets, readiness, or program context before I can make a training-specific recommendation.';
    evidenceKeys = availableEvidence(pack, ['last_workout', 'recovery', 'next_session']);
    followUp = 'What part of your next session are you deciding about?';
  }

  return {
    answer,
    evidenceKeys,
    followUp,
    safetyClass: 'standard',
    boundaryClass: 'fitness',
    source: 'offline',
    notice: 'On-device guidance · live coach unavailable',
    proposalId: preferredOfflineProposalId(
      message,
      pack.readiness.readiness,
      (pack.proposalSet?.options ?? []).filter((option) => (
        pack.proposalOptions.some((candidate) => candidate.id === option.id)
      )),
    ),
  };
}

export function parseCoachReply(value: unknown, pack: CoachContextPack): CoachReply | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.answer !== 'string' || !candidate.answer.trim()) return null;
  const rawFollowUp = typeof candidate.followUp === 'string' ? candidate.followUp : '';
  const outputText = `${candidate.answer}\n${rawFollowUp}`;
  const guardedOutput = guardCoachOutput(outputText);
  if (guardedOutput) return guardedOutput;
  const safetyClass = typeof candidate.safetyClass === 'string' && SAFETY_CLASSES.has(candidate.safetyClass as CoachSafetyClass)
    ? candidate.safetyClass as CoachSafetyClass
    : null;
  if (!safetyClass) return null;
  const boundaryClass = typeof candidate.boundaryClass === 'string' && BOUNDARY_CLASSES.has(candidate.boundaryClass as CoachBoundaryClass)
    ? candidate.boundaryClass as CoachBoundaryClass
    : null;
  if (!boundaryClass) return null;
  if (boundaryClass !== 'fitness') return boundaryReplyForClass(boundaryClass);
  if (safetyClass !== 'standard') return safetyReplyForClass(safetyClass);
  const allowed = new Set(pack.evidence.map((item) => item.key));
  const evidenceKeys = Array.isArray(candidate.evidenceKeys)
    ? candidate.evidenceKeys
        .filter((key): key is CoachEvidenceKey => typeof key === 'string' && allowed.has(key as CoachEvidenceKey))
        .filter((key, index, all) => all.indexOf(key) === index)
        .slice(0, 3)
    : [];
  const answer = compactCoachReplyText(candidate.answer, MAX_COACH_ANSWER_CHARS);
  const followUp = candidate.followUp === null
    ? null
    : typeof candidate.followUp === 'string' && candidate.followUp.trim()
      ? compactCoachReplyText(candidate.followUp, MAX_COACH_FOLLOW_UP_CHARS)
      : null;
  const allowedProposalIds = new Set(pack.proposalOptions.map((option) => option.id));
  const proposalId = typeof candidate.proposalId === 'string' && allowedProposalIds.has(candidate.proposalId)
    ? candidate.proposalId
    : null;
  return {
    answer,
    evidenceKeys,
    followUp,
    safetyClass,
    boundaryClass,
    source: 'model',
    notice: null,
    proposalId,
  };
}

export function compactCoachHistory(history: CoachHistoryItem[]): CoachHistoryItem[] {
  return history
    .filter((item) => item.role === 'user' || item.role === 'assistant')
    .map((item) => ({ role: item.role, content: normalizeCoachMessage(item.content) }))
    .filter((item) => item.content.length > 0)
    .slice(-MAX_COACH_HISTORY_MESSAGES);
}
