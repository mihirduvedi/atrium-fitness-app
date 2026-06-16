import { Text } from 'react-native';
import { ScreenCenter } from '@/components/ui';
import { useTheme } from '@/theme';

/** Out-of-scope screens stay as stubs per the brief (Part F). */
export function StubScreen({ title }: { title: string }) {
  const t = useTheme();
  return (
    <ScreenCenter>
      <Text style={t.text('screenTitle')}>{title}</Text>
      <Text style={t.text('bodyM', 'textMuted')}>Not part of this scaffold.</Text>
    </ScreenCenter>
  );
}
