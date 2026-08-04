import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useApp } from '@/AppContext';
import { Button, Card, Eyebrow, ScreenScroll } from '@/components/ui';
import { getBodyWeightSummary, getDailyCheckIn, saveDailyCheckIn } from '@/health/readiness';
import { borderWidth, radius, space, useTheme } from '@/theme';

type RatingKey = 'energy' | 'mood' | 'sleepQuality' | 'soreness';
type Ratings = Partial<Record<RatingKey, number>>;

const RATING_ROWS: {
  key: RatingKey;
  label: string;
  low: string;
  high: string;
}[] = [
  { key: 'energy', label: 'Energy', low: 'Drained', high: 'High' },
  { key: 'mood', label: 'Mood', low: 'Low', high: 'Great' },
  { key: 'sleepQuality', label: 'Sleep quality', low: 'Poor', high: 'Restful' },
  { key: 'soreness', label: 'Soreness', low: 'Fresh', high: 'Very sore' },
];

function todayKey() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function RatingRow({
  label,
  low,
  high,
  value,
  onChange,
}: {
  label: string;
  low: string;
  high: string;
  value?: number;
  onChange: (value: number) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={t.text('bodyM')}>{label}</Text>
        <Text style={t.text('bodyS', 'textMuted')}>{value ? `${value} / 5` : 'Choose 1–5'}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[1, 2, 3, 4, 5].map((rating) => {
          const selected = rating === value;
          return (
            <Pressable
              key={rating}
              accessibilityRole="radio"
              accessibilityLabel={`${label}: ${rating} of 5`}
              accessibilityState={{ selected }}
              onPress={() => onChange(rating)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 44,
                borderRadius: radius.control,
                borderWidth: borderWidth.hairline,
                borderColor: selected ? t.colors.actionInk : t.colors.borderHairline,
                backgroundColor: selected ? t.colors.actionInk : t.colors.bgSurface2,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.72 : 1,
              })}
            >
              <Text style={t.text('dataS', selected ? 'actionOnInk' : 'textPrimary')}>{rating}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={t.text('bodyS', 'textFaint')}>{low}</Text>
        <Text style={t.text('bodyS', 'textFaint')}>{high}</Text>
      </View>
    </View>
  );
}

export default function DailyCheckInScreen() {
  const t = useTheme();
  const { db, userId, newId } = useApp();
  const [ratings, setRatings] = useState<Ratings>({});
  const [weight, setWeight] = useState('');
  const [units, setUnits] = useState<'lb' | 'kg'>('lb');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const date = useMemo(todayKey, []);

  useEffect(() => {
    let live = true;
    Promise.all([
      getDailyCheckIn(db, userId, date),
      getBodyWeightSummary(db, userId, date),
    ]).then(([checkIn, weightSummary]) => {
      if (!live) return;
      setUnits(weightSummary.units);
      if (checkIn) {
        setEditing(true);
        setRatings({
          energy: checkIn.energy,
          mood: checkIn.mood,
          sleepQuality: checkIn.sleepQuality,
          soreness: checkIn.soreness,
        });
        setWeight(checkIn.weight == null ? '' : String(checkIn.weight));
      } else if (weightSummary.latestDate === date && weightSummary.latestWeight != null) {
        setWeight(String(weightSummary.latestWeight));
      }
      setLoading(false);
    }).catch((nextError) => {
      if (!live) return;
      setError(nextError instanceof Error ? nextError.message : 'Could not load today’s check-in.');
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [date, db, userId]);

  const readyToSave = RATING_ROWS.every((row) => ratings[row.key] !== undefined);

  const save = async () => {
    if (!readyToSave || saving) return;
    const trimmedWeight = weight.trim();
    const parsedWeight = trimmedWeight ? Number(trimmedWeight) : null;
    if (parsedWeight != null && (!Number.isFinite(parsedWeight) || parsedWeight <= 0)) {
      setError(`Enter a valid weight in ${units}, or leave it blank.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveDailyCheckIn(db, {
        userId,
        date,
        energy: ratings.energy!,
        mood: ratings.mood!,
        sleepQuality: ratings.sleepQuality!,
        soreness: ratings.soreness!,
        weight: parsedWeight,
      }, newId);
      router.replace('/(tabs)/today');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not save today’s check-in.');
      setSaving(false);
    }
  };

  return (
    <ScreenScroll>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to Today"
        onPress={() => router.replace('/(tabs)/today')}
        style={({ pressed }) => ({ opacity: pressed ? 0.62 : 1, alignSelf: 'flex-start' })}
      >
        <Text style={t.text('bodyM', 'textMuted')}>‹ Today</Text>
      </Pressable>

      <View style={{ paddingTop: space[1], paddingBottom: space[2] }}>
        <Eyebrow>Daily check-in</Eyebrow>
        <Text style={t.text('screenTitle')}>{editing ? 'Update today’s recovery.' : 'How are you arriving today?'}</Text>
        <Text style={[t.text('bodyM', 'textMuted'), { marginTop: space[2] }]}>
          Four quick ratings tune today’s readiness and give Weekly Review a recovery signal.
        </Text>
      </View>

      <Card style={{ gap: space[5] }}>
        {RATING_ROWS.map((row) => (
          <RatingRow
            key={row.key}
            label={row.label}
            low={row.low}
            high={row.high}
            value={ratings[row.key]}
            onChange={(value) => setRatings((current) => ({ ...current, [row.key]: value }))}
          />
        ))}
      </Card>

      <Card>
        <Eyebrow>Optional</Eyebrow>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
          <View style={{ flex: 1 }}>
            <Text style={t.text('bodyM')}>Body weight</Text>
            <Text style={[t.text('bodyS', 'textMuted'), { marginTop: 2 }]}>Used for your real seven-day trend.</Text>
          </View>
          <View
            style={{
              width: 122,
              minHeight: 46,
              borderRadius: radius.control,
              borderWidth: borderWidth.hairline,
              borderColor: t.colors.borderHairline,
              backgroundColor: t.colors.bgSurface2,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 12,
            }}
          >
            <TextInput
              accessibilityLabel={`Body weight in ${units}`}
              value={weight}
              onChangeText={setWeight}
              placeholder="—"
              placeholderTextColor={t.colors.textFaint}
              keyboardType="decimal-pad"
              selectTextOnFocus
              style={[t.text('dataS'), { flex: 1, minHeight: 44, paddingVertical: 0 }]}
            />
            <Text style={t.text('bodyS', 'textMuted')}>{units}</Text>
          </View>
        </View>
      </Card>

      {error && <Text style={t.text('bodyS', 'dataCoral')}>{error}</Text>}
      <Button
        title={loading ? 'Loading' : saving ? 'Saving' : editing ? 'Update check-in' : 'Save check-in'}
        disabled={loading || saving || !readyToSave}
        onPress={() => void save()}
      />
    </ScreenScroll>
  );
}
