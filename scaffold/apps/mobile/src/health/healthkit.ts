import { Platform } from 'react-native';

/**
 * Native HealthKit import is intentionally gated. Expo Go cannot grant the
 * HealthKit entitlement; a dev/TestFlight build should replace this adapter
 * with the chosen native module and write samples through saveHealthSample.
 */
export async function canRequestHealthKit(): Promise<boolean> {
  return Platform.OS === 'ios' && false;
}

export async function requestHealthKitImport(): Promise<{ ok: boolean; reason?: string }> {
  if (!(await canRequestHealthKit())) {
    return { ok: false, reason: 'HealthKit needs a native iOS build with Health permissions.' };
  }
  return { ok: false, reason: 'HealthKit adapter is not connected yet.' };
}
