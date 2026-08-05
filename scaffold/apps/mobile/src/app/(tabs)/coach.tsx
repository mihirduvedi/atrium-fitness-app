import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '@/AppContext';
import {
  buildCoachContextPack,
  formatCompactNumber,
  type CoachContextPack,
  type CoachEvidence,
} from '@/coach/context';
import {
  MAX_COACH_MESSAGE_CHARS,
  normalizeCoachMessage,
  preflightCoachReply,
  type CoachHistoryItem,
  type CoachReply,
} from '@/coach/chat';
import { askCoach } from '@/coach/service';
import {
  appendCoachMessage,
  coachHistoryInputPolicy,
  coachThreadDisplayTitle,
  createCoachThread,
  deleteCoachThread,
  listCoachMessages,
  listCoachThreads,
  type CoachThread,
  type StoredCoachMessage,
} from '@/coach/history';
import { Button, Card, Eyebrow, ScreenScroll } from '@/components/ui';
import { PremiumFeatureScreen } from '@/subscriptions/PremiumFeatureScreen';
import { canAccessSubscriptionFeature } from '@/subscriptions/subscription';
import { borderWidth, layout, radius, space, useTheme } from '@/theme';

const PROMPTS = [
  'Why am I stuck?',
  "I'm traveling next week",
  'Feeling run down',
  'Make next workout harder',
];

interface CoachUiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  historyContent?: string;
  reply?: CoachReply;
  evidence?: CoachEvidence[];
}

function Chip({ children }: { children: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        height: 36,
        flexShrink: 1,
        borderWidth: borderWidth.hairline,
        borderColor: t.colors.borderStrong,
        borderRadius: radius.control,
        paddingHorizontal: 10,
        justifyContent: 'center',
        backgroundColor: t.colors.bgSurface,
      }}
    >
      <Text adjustsFontSizeToFit minimumFontScale={0.78} numberOfLines={1} style={t.text('bodyS', 'textMuted')}>
        {children}
      </Text>
    </View>
  );
}

function Bubble({ children, mine }: { children: string; mine?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        maxWidth: '88%',
        alignSelf: mine ? 'flex-end' : 'flex-start',
        backgroundColor: mine ? t.colors.actionInk : t.colors.bgSurface,
        borderWidth: mine ? 0 : borderWidth.hairline,
        borderColor: t.colors.borderHairline,
        borderRadius: radius.card,
        borderBottomRightRadius: mine ? 4 : radius.card,
        borderBottomLeftRadius: mine ? radius.card : 4,
        paddingHorizontal: 15,
        paddingVertical: 13,
      }}
    >
      <Text style={t.text('bodyM', mine ? 'actionOnInk' : 'textPrimary')}>{children}</Text>
    </View>
  );
}

function ReplyEvidence({ reply, evidence }: { reply: CoachReply; evidence: CoachEvidence[] }) {
  const t = useTheme();
  if (evidence.length === 0 && !reply.notice) return null;
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        maxWidth: '92%',
        borderLeftWidth: 2,
        borderLeftColor: reply.source === 'safety' || reply.source === 'boundary' ? t.colors.dataCoral : t.colors.dataBlue,
        paddingLeft: space[3],
        gap: 3,
      }}
    >
      <Text style={t.text('labelCaps', 'textMuted')}>
        {reply.source === 'model'
          ? 'Grounded in your log'
          : reply.source === 'safety'
            ? 'Safety boundary'
            : reply.source === 'boundary'
              ? 'Protected Coach boundary'
              : 'On-device fallback'}
      </Text>
      {evidence.map((item) => (
        <Text key={item.key} style={t.text('bodyS', 'textMuted')}>
          {item.label}: {item.value}
        </Text>
      ))}
      {reply.notice && <Text style={t.text('bodyS', 'textFaint')}>{reply.notice}</Text>}
    </View>
  );
}

function toUiMessage(message: StoredCoachMessage): CoachUiMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    historyContent: message.historyContent,
    reply: message.reply ?? undefined,
    evidence: message.evidence,
  };
}

function ConversationDrawer({
  activeThreadId,
  busy,
  onClose,
  onDelete,
  onNew,
  onSelect,
  storageNotice,
  threads,
  visible,
}: {
  activeThreadId: string | null;
  busy: boolean;
  onClose: () => void;
  onDelete: (thread: CoachThread) => void;
  onNew: () => void;
  onSelect: (threadId: string) => void;
  storageNotice: string | null;
  threads: CoachThread[];
  visible: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      visible={visible}
    >
      <SafeAreaView
        accessibilityViewIsModal
        edges={['bottom']}
        style={{ flex: 1, backgroundColor: t.colors.bgCanvas, paddingTop: Math.max(insets.top, 52) }}
      >
        <View
          style={{
            minHeight: 68,
            paddingHorizontal: layout.screenMargin,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottomWidth: borderWidth.hairline,
            borderBottomColor: t.colors.borderHairline,
          }}
        >
          <View>
            <Eyebrow>Private on this device</Eyebrow>
            <Text style={t.text('displayS')}>Conversations</Text>
          </View>
          <Pressable
            accessibilityLabel="Close conversations"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClose}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: borderWidth.hairline,
              borderColor: t.colors.borderHairline,
              backgroundColor: t.colors.bgSurface,
              opacity: pressed ? 0.62 : 1,
            })}
          >
            <SymbolView
              name={{ ios: 'xmark', android: 'close', web: 'close' }}
              size={18}
              tintColor={t.colors.textPrimary}
            />
          </Pressable>
        </View>

        <ScrollView
          alwaysBounceVertical={false}
          contentContainerStyle={{
            paddingHorizontal: layout.screenMargin,
            paddingTop: space[4],
            paddingBottom: space[6],
            gap: space[3],
          }}
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            accessibilityLabel="Start a new Coach conversation"
            accessibilityRole="button"
            disabled={busy}
            onPress={onNew}
            style={({ pressed }) => ({
              minHeight: 52,
              borderRadius: radius.control,
              borderWidth: borderWidth.hairline,
              borderColor: t.colors.borderStrong,
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[3],
              paddingHorizontal: space[4],
              backgroundColor: pressed ? t.colors.bgSurface2 : t.colors.bgSurface,
              opacity: busy ? 0.4 : 1,
            })}
          >
            <SymbolView
              name={{ ios: 'square.and.pencil', android: 'edit_square', web: 'edit_square' }}
              size={20}
              tintColor={t.colors.textPrimary}
            />
            <Text style={t.text('button')}>New conversation</Text>
          </Pressable>

          <View style={{ marginTop: space[2] }}>
            <Eyebrow>Recent</Eyebrow>
          </View>

          {threads.length > 0 ? (
            <View
              style={{
                borderWidth: borderWidth.hairline,
                borderColor: t.colors.borderHairline,
                borderRadius: radius.control,
                backgroundColor: t.colors.bgSurface,
                overflow: 'hidden',
              }}
            >
              {threads.map((thread, index) => {
                const active = thread.id === activeThreadId;
                const displayTitle = coachThreadDisplayTitle(thread.title);
                return (
                  <View
                    key={thread.id}
                    style={{
                      minHeight: 58,
                      flexDirection: 'row',
                      alignItems: 'center',
                      backgroundColor: active ? t.colors.bgSurface2 : t.colors.bgSurface,
                      borderBottomWidth: index < threads.length - 1 ? borderWidth.hairline : 0,
                      borderBottomColor: t.colors.borderHairline,
                    }}
                  >
                    <Pressable
                      accessibilityHint="Long press to delete this conversation."
                      accessibilityLabel={thread.title}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      delayLongPress={450}
                      disabled={busy}
                      onLongPress={() => onDelete(thread)}
                      onPress={() => onSelect(thread.id)}
                      style={({ pressed }) => ({
                        flex: 1,
                        minHeight: 58,
                        justifyContent: 'center',
                        paddingLeft: space[4],
                        paddingRight: space[2],
                        opacity: busy ? 0.45 : pressed ? 0.62 : 1,
                      })}
                    >
                      <Text numberOfLines={1} style={t.text('bodyM', active ? 'textPrimary' : 'textMuted')}>
                        {displayTitle}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`Delete ${displayTitle}`}
                      accessibilityRole="button"
                      disabled={busy}
                      hitSlop={4}
                      onPress={() => onDelete(thread)}
                      style={({ pressed }) => ({
                        width: 48,
                        height: 48,
                        marginRight: space[1],
                        borderRadius: radius.control,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: pressed ? t.colors.bgCanvas : 'transparent',
                        opacity: busy ? 0.35 : pressed ? 0.7 : 1,
                      })}
                    >
                      <SymbolView
                        name={{ ios: 'trash', android: 'delete', web: 'delete' }}
                        size={17}
                        tintColor={t.colors.textMuted}
                      />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ) : (
            <Card>
              <Text style={t.text('bodyM')}>No saved conversations yet.</Text>
              <Text style={[t.text('bodyS', 'textMuted'), { marginTop: 4 }]}>Your first question will start one.</Text>
            </Card>
          )}

          {storageNotice && <Text style={t.text('bodyS', 'dataCoral')}>{storageNotice}</Text>}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function CoachContent() {
  const t = useTheme();
  const { db, userId, newId } = useApp();
  const [pack, setPack] = useState<CoachContextPack | null>(null);
  const [threads, setThreads] = useState<CoachThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CoachUiMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversationDrawerOpen, setConversationDrawerOpen] = useState(false);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      Promise.all([buildCoachContextPack(db, userId), listCoachThreads(db, userId)]).then(async ([contextPack, recentThreads]) => {
        const selected = recentThreads[0]?.id ?? null;
        const storedMessages = selected ? await listCoachMessages(db, userId, selected) : [];
        if (!live) return;
        setPack(contextPack);
        setThreads(recentThreads);
        setActiveThreadId(selected);
        setMessages(storedMessages.map(toUiMessage));
        setStorageNotice(null);
      }).catch(() => {
        if (live) setStorageNotice('Conversation history is unavailable. New replies still work in this session.');
      });
      return () => {
        live = false;
      };
    }, [db, userId]),
  );

  const pinCaption = pack && pack.week.workouts > 0
    ? `${formatCompactNumber(pack.week.volume)} ${pack.profile?.units ?? 'lb'} this week · ${pack.week.workouts} sessions · ${pack.prSignals.length || 0} PR signals`
    : 'No completed sessions this week yet';
  const history = useMemo<CoachHistoryItem[]>(
    () => messages.map((message) => ({ role: message.role, content: message.historyContent ?? message.content })),
    [messages],
  );

  const refreshThreads = useCallback(async () => {
    const recent = await listCoachThreads(db, userId);
    setThreads(recent);
    return recent;
  }, [db, userId]);

  const selectThread = useCallback(async (threadId: string) => {
    if (busy) return;
    if (threadId === activeThreadId) {
      setConversationDrawerOpen(false);
      return;
    }
    try {
      const stored = await listCoachMessages(db, userId, threadId);
      setActiveThreadId(threadId);
      setMessages(stored.map(toUiMessage));
      setDraft('');
      setStorageNotice(null);
      setConversationDrawerOpen(false);
    } catch {
      setStorageNotice('That conversation could not be opened.');
    }
  }, [activeThreadId, busy, db, userId]);

  const startNewThread = useCallback(() => {
    if (busy) return;
    setActiveThreadId(null);
    setMessages([]);
    setDraft('');
    setStorageNotice(null);
    setConversationDrawerOpen(false);
  }, [busy]);

  const confirmDeleteThread = useCallback((thread: CoachThread) => {
    if (busy) return;
    const displayTitle = coachThreadDisplayTitle(thread.title);
    Alert.alert(
      'Delete conversation?',
      `This permanently removes “${displayTitle}” from Atrium on this device.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteCoachThread(db, userId, thread.id);
                const recent = await refreshThreads();
                if (thread.id === activeThreadId) {
                  const nextId = recent[0]?.id ?? null;
                  const stored = nextId ? await listCoachMessages(db, userId, nextId) : [];
                  setActiveThreadId(nextId);
                  setMessages(stored.map(toUiMessage));
                }
                setStorageNotice(null);
              } catch {
                setStorageNotice('The conversation could not be deleted.');
              }
            })();
          },
        },
      ],
    );
  }, [activeThreadId, busy, db, refreshThreads, userId]);

  const submit = useCallback(async (rawMessage: string) => {
    const content = normalizeCoachMessage(rawMessage);
    if (!content || !pack || busy) return;
    setBusy(true);
    setStorageNotice(null);
    try {
      const localPreflight = preflightCoachReply(content);
      const storagePolicy = coachHistoryInputPolicy(content, localPreflight);
      let threadId = activeThreadId;
      let canPersist = true;
      if (!threadId) {
        threadId = newId();
        try {
          await createCoachThread(db, {
            id: threadId,
            userId,
            title: storagePolicy.threadTitle,
          });
          setActiveThreadId(threadId);
        } catch {
          canPersist = false;
          setStorageNotice('This conversation is temporary because local history could not be saved.');
        }
      }
      const userMessage: CoachUiMessage = {
        id: newId(),
        role: 'user',
        content,
        historyContent: storagePolicy.historyContent,
      };
      setMessages((current) => [...current, userMessage]);
      setDraft('');
      if (canPersist && threadId) {
        try {
          await appendCoachMessage(db, {
            id: userMessage.id,
            threadId,
            userId,
            role: 'user',
            content: storagePolicy.storedContent,
            historyContent: storagePolicy.historyContent,
          });
        } catch {
          canPersist = false;
          setStorageNotice('This conversation is temporary because local history could not be saved.');
        }
      }
      const reply = await askCoach(pack, content, history);
      const evidenceByKey = new Map(pack.evidence.map((item) => [item.key, item]));
      const evidence = reply.evidenceKeys
        .map((key) => evidenceByKey.get(key))
        .filter((item): item is CoachEvidence => !!item);
      const assistantContent = reply.followUp ? `${reply.answer}\n\n${reply.followUp}` : reply.answer;
      const assistantMessage: CoachUiMessage = {
        id: newId(),
        role: 'assistant',
        content: assistantContent,
        historyContent: reply.source === 'model' || reply.source === 'offline' ? assistantContent : '',
        reply,
        evidence,
      };
      setMessages((current) => [...current, assistantMessage]);
      if (canPersist && threadId) {
        try {
          await appendCoachMessage(db, {
            id: assistantMessage.id,
            threadId,
            userId,
            role: 'assistant',
            content: assistantContent,
            historyContent: assistantMessage.historyContent,
            reply,
            evidence,
          });
          await refreshThreads();
        } catch {
          setStorageNotice('The latest reply could not be added to local history.');
        }
      }
    } catch {
      setStorageNotice('Coach could not finish that reply. You can retry in this conversation.');
    } finally {
      setBusy(false);
    }
  }, [activeThreadId, busy, db, history, newId, pack, refreshThreads, userId]);

  return (
    <>
      <ScreenScroll>
        <View
          style={{
            paddingHorizontal: 2,
            paddingBottom: space[2],
            paddingRight: 58,
          }}
        >
          <Eyebrow>Grounded in your log</Eyebrow>
          <Text style={t.text('screenTitle')}>Coach</Text>
        </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <Chip>{`${pack?.recentWorkouts.length ?? 0} workouts`}</Chip>
        <Chip>{`${pack?.prSignals.length ?? 0} PR signals`}</Chip>
        <Chip>{pack?.program?.nextWeek ? `Program · W${pack.program.nextWeek}` : 'Program ready'}</Chip>
        <Pressable
          accessibilityLabel="Open conversations"
          accessibilityRole="button"
          hitSlop={4}
          onPress={() => setConversationDrawerOpen(true)}
          style={({ pressed }) => ({
            width: 36,
            height: 36,
            marginLeft: 'auto',
            flexShrink: 0,
            borderRadius: radius.control,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: borderWidth.hairline,
            borderColor: t.colors.borderStrong,
            backgroundColor: pressed ? t.colors.bgSurface2 : t.colors.bgSurface,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <SymbolView
            name={{ ios: 'line.3.horizontal', android: 'menu', web: 'menu' }}
            size={18}
            tintColor={t.colors.textPrimary}
          />
        </Pressable>
      </View>

      {storageNotice && <Text style={t.text('bodyS', 'dataCoral')}>{storageNotice}</Text>}

      <Pressable onPress={() => router.push('/review')} style={({ pressed }) => ({ opacity: pressed ? 0.68 : 1 })}>
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space[3] }}>
            <View style={{ flex: 1 }}>
              <Text style={t.text('bodyM')}>Weekly review</Text>
              <Text style={[t.text('bodyS', 'textMuted'), { marginTop: 2 }]}>{pinCaption}</Text>
            </View>
            <Text style={t.text('bodyM', 'textMuted')}>→</Text>
          </View>
        </Card>
      </Pressable>

      {(messages.length > 0 || busy) && (
        <View style={{ gap: space[3] }}>
          {messages.map((message) => (
            <View key={message.id} style={{ gap: space[2] }}>
              <Bubble mine={message.role === 'user'}>{message.content}</Bubble>
              {message.reply && <ReplyEvidence reply={message.reply} evidence={message.evidence ?? []} />}
            </View>
          ))}
          {busy && <Bubble>Reading your log…</Bubble>}
        </View>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space[2], paddingVertical: space[1] }}
      >
        {PROMPTS.map((prompt) => (
          <Pressable
            key={prompt}
            disabled={busy || !pack}
            onPress={() => void submit(prompt)}
            style={({ pressed }) => ({
              flexShrink: 0,
              borderRadius: radius.control,
              borderWidth: borderWidth.hairline,
              borderColor: t.colors.borderHairline,
              backgroundColor: t.colors.bgSurface,
              paddingHorizontal: 14,
              paddingVertical: 9,
              opacity: busy || !pack ? 0.4 : pressed ? 0.62 : 1,
            })}
          >
            <Text style={t.text('bodyS', 'textMuted')}>{prompt}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Card>
        <Eyebrow>Ask about your training</Eyebrow>
        <TextInput
          accessibilityLabel="Ask Atrium Coach"
          value={draft}
          onChangeText={setDraft}
          editable={!busy}
          maxLength={MAX_COACH_MESSAGE_CHARS}
          multiline
          placeholder="What workout should I do today?"
          placeholderTextColor={t.colors.textFaint}
          style={[
            t.text('bodyM'),
            {
              minHeight: 84,
              maxHeight: 150,
              borderWidth: borderWidth.hairline,
              borderColor: t.colors.borderHairline,
              borderRadius: radius.control,
              backgroundColor: t.colors.bgCanvas,
              paddingHorizontal: space[3],
              paddingVertical: space[3],
              textAlignVertical: 'top',
              marginBottom: space[3],
            },
          ]}
        />
        <Button
          title={busy ? 'Reading your log…' : 'Ask Coach'}
          disabled={busy || !pack || !normalizeCoachMessage(draft)}
          onPress={() => void submit(draft)}
        />
        <Text style={[t.text('bodyS', 'textFaint'), { marginTop: space[2] }]}>
          Fitness guidance only. Atrium does not diagnose injuries, reveal protected information, or access another user’s data.
        </Text>
      </Card>

      <Card>
        <Eyebrow>Coach context</Eyebrow>
        <View style={{ gap: 11 }}>
          <Text style={t.text('bodyM')}>{pack?.program?.nextDayName ?? 'Next session'} is the active plan target.</Text>
          <Text style={t.text('bodyM', 'textMuted')}>
            Answers use minimized training fields from your profile, recent log, PRs, recovery, and current plan. Account contact details and raw record IDs are not sent to the model, and a response cannot change your program.
          </Text>
        </View>
      </Card>
      </ScreenScroll>
      <ConversationDrawer
        activeThreadId={activeThreadId}
        busy={busy}
        onClose={() => setConversationDrawerOpen(false)}
        onDelete={confirmDeleteThread}
        onNew={startNewThread}
        onSelect={(threadId) => void selectThread(threadId)}
        storageNotice={storageNotice}
        threads={threads}
        visible={conversationDrawerOpen}
      />
    </>
  );
}

export default function CoachScreen() {
  const { subscription } = useApp();
  if (!canAccessSubscriptionFeature('coach', subscription.hasPremiumAccess)) {
    return (
      <PremiumFeatureScreen
        eyebrow="Atrium Premium"
        title="A coach grounded in your log."
        detail="Unlock training guidance built from your recent sessions, PRs, recovery, and active program."
      />
    );
  }
  return <CoachContent />;
}
