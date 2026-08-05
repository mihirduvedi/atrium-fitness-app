import { IBMPlexMono_400Regular, IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono';
import { SourceSerif4_500Medium, SourceSerif4_600SemiBold } from '@expo-google-fonts/source-serif-4';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppProvider } from '@/AppContext';
import { AtriumFloatingNav } from '@/components/AtriumTabBar';
import { ThemePreferenceProvider, useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

function RootStack() {
  const t = useTheme();
  const [fontsLoaded] = useFonts({
    SourceSerif4_500Medium,
    SourceSerif4_600SemiBold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <AppProvider>
      <StatusBar style={t.mode === 'night' ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: t.colors.bgCanvas }}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: t.colors.bgCanvas },
            animation: 'fade',
            animationDuration: 220,
          }}
        >
          <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="library" />
          <Stack.Screen name="program" />
          <Stack.Screen name="program-library" />
          <Stack.Screen name="workout-plan-library" />
          <Stack.Screen name="photos" />
          <Stack.Screen name="check-in" />
          <Stack.Screen name="paywall" />
          <Stack.Screen name="exercise/[id]" />
          <Stack.Screen name="workout-history/[workoutId]" />
          <Stack.Screen name="review" />
          <Stack.Screen name="workout" options={{ gestureEnabled: false }} />
          <Stack.Screen name="summary" options={{ gestureEnabled: false }} />
        </Stack>
        <AtriumFloatingNav />
      </View>
    </AppProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemePreferenceProvider>
        <RootStack />
      </ThemePreferenceProvider>
    </GestureHandlerRootView>
  );
}
