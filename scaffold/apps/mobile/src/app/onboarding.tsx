import {
  archetypeById,
  exerciseCatalog,
  instantiateProgram,
  selectArchetype,
  type DaysPerWeek,
  type EquipmentAccess,
  type Experience,
  type Goal,
  type OnboardingAnswers,
} from '@atrium/engine';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useApp } from '@/AppContext';
import { Button, Card, Eyebrow } from '@/components/ui';
import { createProgramFromOnboarding } from '@/db/queries';
import { borderWidth, layout, radius, space, useTheme } from '@/theme';

const DEFAULT_ANSWERS: OnboardingAnswers = {
  goal: 'strength',
  experience: 'intermediate',
  equipment: 'full_gym',
  days_per_week: 4,
};

const GOALS: OptionDef<Goal>[] = [
  { value: 'strength', title: 'Build strength', detail: 'Lift heavier and progress the big patterns.' },
  { value: 'muscle', title: 'Build muscle', detail: 'Balanced volume for steady hypertrophy.' },
  { value: 'fat_loss', title: 'Lose fat, keep strength', detail: 'Protect muscle while training in a deficit.' },
  { value: 'general', title: 'General fitness', detail: 'Consistent, well-rounded training.' },
];

const EXPERIENCE: OptionDef<Experience>[] = [
  { value: 'new', title: 'New to lifting', detail: 'Less than 6 months.' },
  { value: 'returning', title: 'Coming back', detail: 'Trained before, restarting now.' },
  { value: 'intermediate', title: '1-3 years consistent', detail: 'Comfortable with the main lifts.' },
  { value: 'advanced', title: '3+ years', detail: 'Experienced, with room for periodization.' },
];

const EQUIPMENT: OptionDef<EquipmentAccess>[] = [
  { value: 'full_gym', title: 'Full gym', detail: 'Barbells, machines, cables, and dumbbells.' },
  { value: 'home_barbell', title: 'Barbell + rack', detail: 'Plates, bench, maybe a pull-up bar.' },
  { value: 'dumbbell', title: 'Dumbbells only', detail: 'Adjustable or a few pairs.' },
  { value: 'bodyweight', title: 'Bodyweight for now', detail: 'No equipment yet.' },
];

const DAYS: OptionDef<DaysPerWeek>[] = [
  { value: 2, title: '2 days', detail: 'Full-body and efficient.' },
  { value: 3, title: '3 days', detail: 'The consistency sweet spot.' },
  { value: 4, title: '4 days', detail: 'Upper / lower split.' },
  { value: 5, title: '5+ days', detail: 'For established routines.' },
];

interface OptionDef<T extends string | number> {
  value: T;
  title: string;
  detail: string;
}

function ProgressDots({ step }: { step: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View
          key={i}
          style={{
            width: i === step ? 18 : 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: i <= step ? t.colors.actionInk : t.colors.bgSurface2,
          }}
        />
      ))}
    </View>
  );
}

function CheckMark({ active }: { active: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? t.colors.actionInk : 'transparent',
        borderWidth: borderWidth.hairline,
        borderColor: active ? t.colors.actionInk : t.colors.borderStrong,
      }}
    >
      {active && (
        <Svg width={14} height={14} viewBox="0 0 24 24">
          <Path d="M5 12.5 9.4 17 19 7" fill="none" stroke={t.colors.actionOnInk} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      )}
    </View>
  );
}

function Option<T extends string | number>({
  option,
  active,
  onPress,
}: {
  option: OptionDef<T>;
  active: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 74,
        borderRadius: radius.card,
        borderWidth: active ? borderWidth.emphasis : borderWidth.hairline,
        borderColor: active ? t.colors.actionInk : t.colors.borderHairline,
        backgroundColor: active ? t.colors.bgSurface2 : t.colors.bgSurface,
        paddingHorizontal: 16,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={t.text('bodyM')}>{option.title}</Text>
        <Text style={[t.text('bodyS', 'textMuted'), { marginTop: 2 }]}>{option.detail}</Text>
      </View>
      <CheckMark active={active} />
    </Pressable>
  );
}

function RecoveryBadge() {
  const t = useTheme();
  return (
    <View
      style={{
        width: 74,
        height: 74,
        borderRadius: 37,
        backgroundColor: t.colors.bgSurface2,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: space[4],
      }}
    >
      <Svg width={36} height={36} viewBox="0 0 24 24">
        <Path
          d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.7A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"
          fill="none"
          stroke={t.colors.dataBlue}
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

function Chip({ children }: { children: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        borderRadius: radius.control,
        borderWidth: borderWidth.hairline,
        borderColor: t.colors.borderStrong,
        backgroundColor: t.colors.bgSurface,
        paddingHorizontal: 11,
        paddingVertical: 7,
      }}
    >
      <Text style={t.text('bodyS', 'textMuted')}>{children}</Text>
    </View>
  );
}

function titleCase(value: string) {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export default function OnboardingScreen() {
  const t = useTheme();
  const { db, userId, newId } = useApp();
  const [answers, setAnswers] = useState<OnboardingAnswers>(DEFAULT_ANSWERS);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const archetypeId = useMemo(() => selectArchetype(answers), [answers]);
  const preview = useMemo(() => {
    let n = 0;
    return instantiateProgram(archetypeId, answers.equipment, answers.experience, (kind) => `preview-${kind}-${++n}`);
  }, [answers.equipment, answers.experience, archetypeId]);
  const firstDay = preview.days[0];
  const firstExercises = (firstDay?.slots ?? [])
    .slice(0, 5)
    .map((slot) => exerciseCatalog[slot.exerciseId]?.name ?? slot.exerciseId)
    .join(' · ');

  function setAnswer<K extends keyof OnboardingAnswers>(key: K, value: OnboardingAnswers[K]) {
    setAnswers((current) => ({ ...current, [key]: value }));
  }

  async function finish(nextAnswers = answers) {
    if (saving) return;
    setSaving(true);
    try {
      await createProgramFromOnboarding(db, userId, nextAnswers, newId);
      router.replace('/today');
    } finally {
      setSaving(false);
    }
  }

  const next = () => setStep((current) => Math.min(5, current + 1));
  const back = () => setStep((current) => Math.max(0, current - 1));

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.bgCanvas }}>
      <ScrollView
        style={{ flex: 1 }}
        alwaysBounceVertical
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: layout.screenMargin,
          paddingTop: space[3],
          paddingBottom: space[7],
          minHeight: '100%',
        }}
      >
        <View style={{ minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {step > 0 && step < 5 ? (
            <Pressable onPress={back} hitSlop={10}>
              <Text style={t.text('bodyS', 'textMuted')}>Back</Text>
            </Pressable>
          ) : (
            <View style={{ width: 36 }} />
          )}
          {step < 5 ? <ProgressDots step={step} /> : <View />}
          <View style={{ width: 36 }} />
        </View>

        {step === 0 && (
          <View style={{ gap: space[3], marginTop: space[7] }}>
            <Eyebrow>Set up · 1 of 5</Eyebrow>
            <Text style={t.text('screenTitle')}>What are you training for?</Text>
            <Text style={t.text('bodyM', 'textMuted')}>Your plan starts here and can change as your training changes.</Text>
            <View style={{ gap: space[3], marginTop: space[3] }}>
              {GOALS.map((option) => (
                <Option
                  key={option.value}
                  option={option}
                  active={answers.goal === option.value}
                  onPress={() => setAnswer('goal', option.value)}
                />
              ))}
            </View>
            <Button title="Continue" onPress={next} style={{ marginTop: space[3] }} />
          </View>
        )}

        {step === 1 && (
          <View style={{ gap: space[3], marginTop: space[7] }}>
            <Eyebrow>Set up · 2 of 5</Eyebrow>
            <Text style={t.text('screenTitle')}>How long have you been training?</Text>
            <Text style={t.text('bodyM', 'textMuted')}>This sets starting volume, exercise difficulty, and progression speed.</Text>
            <View style={{ gap: space[3], marginTop: space[3] }}>
              {EXPERIENCE.map((option) => (
                <Option
                  key={option.value}
                  option={option}
                  active={answers.experience === option.value}
                  onPress={() => setAnswer('experience', option.value)}
                />
              ))}
            </View>
            <Button title="Continue" onPress={next} style={{ marginTop: space[3] }} />
          </View>
        )}

        {step === 2 && (
          <View style={{ gap: space[3], marginTop: space[7] }}>
            <Eyebrow>Set up · 3 of 5</Eyebrow>
            <Text style={t.text('screenTitle')}>What equipment do you have?</Text>
            <Text style={t.text('bodyM', 'textMuted')}>Your program only uses exercises that fit your setup.</Text>
            <View style={{ gap: space[3], marginTop: space[3] }}>
              {EQUIPMENT.map((option) => (
                <Option
                  key={option.value}
                  option={option}
                  active={answers.equipment === option.value}
                  onPress={() => setAnswer('equipment', option.value)}
                />
              ))}
            </View>
            <Button title="Continue" onPress={next} style={{ marginTop: space[3] }} />
          </View>
        )}

        {step === 3 && (
          <View style={{ gap: space[3], marginTop: space[7] }}>
            <Eyebrow>Set up · 4 of 5</Eyebrow>
            <Text style={t.text('screenTitle')}>How many days a week?</Text>
            <Text style={t.text('bodyM', 'textMuted')}>Pick the week you can repeat, not the perfect week on paper.</Text>
            <View style={{ gap: space[3], marginTop: space[3] }}>
              {DAYS.map((option) => (
                <Option
                  key={option.value}
                  option={option}
                  active={answers.days_per_week === option.value}
                  onPress={() => setAnswer('days_per_week', option.value)}
                />
              ))}
            </View>
            <Button title="Continue" onPress={next} style={{ marginTop: space[3] }} />
          </View>
        )}

        {step === 4 && (
          <View style={{ flex: 1, minHeight: 620, justifyContent: 'center', gap: space[3] }}>
            <RecoveryBadge />
            <Eyebrow>Set up · 5 of 5</Eyebrow>
            <Text style={t.text('screenTitle')}>Recovery can shape the plan later.</Text>
            <Text style={t.text('bodyM', 'textMuted')}>
              Sleep, resting heart rate, and activity will eventually tune readiness. Your first program works without Health access.
            </Text>
            <Button title="Continue" onPress={next} style={{ marginTop: space[4] }} />
            <Button title="Set up later" ghost onPress={next} />
          </View>
        )}

        {step === 5 && (
          <View style={{ gap: space[4], marginTop: space[7] }}>
            <Eyebrow>All set</Eyebrow>
            <Text style={t.text('screenTitle')}>Your first program is ready.</Text>
            <Text style={t.text('bodyM', 'textMuted')}>Built from your answers. It adapts as you log.</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[2] }}>
              <Chip>{archetypeById.get(archetypeId)?.name ?? titleCase(archetypeId)}</Chip>
              <Chip>{`${answers.days_per_week} days / wk`}</Chip>
              <Chip>{titleCase(answers.goal)}</Chip>
              <Chip>{titleCase(answers.equipment)}</Chip>
            </View>
            <Card style={{ marginTop: space[2] }}>
              <Eyebrow>Week 1 · Day 1</Eyebrow>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[3] }}>
                <Text style={[t.text('displayS'), { flex: 1 }]}>{firstDay?.name ?? 'First session'}</Text>
                <Text style={t.text('bodyS', 'textMuted')}>~50 min</Text>
              </View>
              <Text style={[t.text('bodyS', 'textMuted'), { marginTop: space[2] }]}>{firstExercises}</Text>
            </Card>
            <View style={{ marginTop: space[3], gap: space[2] }}>
              <Button title={saving ? 'Building plan...' : 'See your plan'} disabled={saving} onPress={() => finish()} />
              <Button title="Review answers" ghost disabled={saving} onPress={() => setStep(0)} />
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
