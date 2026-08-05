import { Linking, Platform } from 'react-native';
import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
  type CustomerInfoUpdateListener,
  type PurchasesOffering,
  type PurchasesPackage,
} from 'react-native-purchases';
import {
  classifySubscriptionError,
  completedSubscriptionAction,
  loadingSubscription,
  normalizeSubscriptionPackages,
  subscriptionErrorMessage,
  subscriptionFromCustomerInfo,
  unconfiguredSubscription,
  type SubscriptionActionResult,
  type SubscriptionPackage,
  type SubscriptionSnapshot,
} from './subscription';

interface RevenueCatConfig {
  apiKey: string;
  entitlementId: string;
  offeringId: string | null;
}

export interface SubscriptionClient {
  initialSnapshot: SubscriptionSnapshot;
  initialize: (appUserId: string, onUpdate: (snapshot: SubscriptionSnapshot) => void) => Promise<SubscriptionSnapshot>;
  refresh: () => Promise<SubscriptionSnapshot>;
  purchase: (packageId: string) => Promise<SubscriptionActionResult>;
  restore: () => Promise<SubscriptionActionResult>;
  openManagement: () => Promise<SubscriptionActionResult>;
  dispose: () => void;
}

function envValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readConfig(): RevenueCatConfig | null {
  const apiKey = Platform.OS === 'ios'
    ? envValue(process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY)
    : Platform.OS === 'android'
      ? envValue(process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY)
      : null;
  const entitlementId = envValue(process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID);
  if (!apiKey || !entitlementId) return null;
  return {
    apiKey,
    entitlementId,
    offeringId: envValue(process.env.EXPO_PUBLIC_REVENUECAT_OFFERING_ID),
  };
}

function unavailableClient(): SubscriptionClient {
  const initialSnapshot = unconfiguredSubscription();
  return {
    initialSnapshot,
    initialize: async (_appUserId, onUpdate) => {
      onUpdate(initialSnapshot);
      return initialSnapshot;
    },
    refresh: async () => initialSnapshot,
    purchase: async () => ({
      outcome: 'unavailable',
      snapshot: initialSnapshot,
      message: initialSnapshot.errorMessage ?? 'Subscriptions are unavailable in this build.',
    }),
    restore: async () => ({
      outcome: 'unavailable',
      snapshot: initialSnapshot,
      message: initialSnapshot.errorMessage ?? 'Subscriptions are unavailable in this build.',
    }),
    openManagement: async () => ({
      outcome: 'unavailable',
      snapshot: initialSnapshot,
      message: 'There is no active store subscription to manage.',
    }),
    dispose: () => {},
  };
}

class RevenueCatClient implements SubscriptionClient {
  readonly initialSnapshot: SubscriptionSnapshot;
  private snapshot: SubscriptionSnapshot;
  private packageById = new Map<string, PurchasesPackage>();
  private updateListener: CustomerInfoUpdateListener | null = null;
  private onUpdate: ((snapshot: SubscriptionSnapshot) => void) | null = null;

  constructor(private readonly config: RevenueCatConfig) {
    this.initialSnapshot = loadingSubscription(config.entitlementId, config.offeringId);
    this.snapshot = this.initialSnapshot;
  }

  private emit(snapshot: SubscriptionSnapshot): SubscriptionSnapshot {
    this.snapshot = snapshot;
    this.onUpdate?.(snapshot);
    return snapshot;
  }

  private snapshotFor(customerInfo: CustomerInfo, packages = this.snapshot.packages): SubscriptionSnapshot {
    return subscriptionFromCustomerInfo(
      customerInfo,
      this.config.entitlementId,
      this.config.offeringId,
      packages,
    );
  }

  private offeringFrom(all: Record<string, PurchasesOffering>, current: PurchasesOffering | null): PurchasesOffering | null {
    return this.config.offeringId ? all[this.config.offeringId] ?? null : current;
  }

  private setPackages(offering: PurchasesOffering | null): SubscriptionPackage[] {
    this.packageById.clear();
    if (!offering) return [];
    for (const pkg of offering.availablePackages) this.packageById.set(pkg.identifier, pkg);
    return normalizeSubscriptionPackages(offering.availablePackages);
  }

  private failedSnapshot(error: unknown): SubscriptionSnapshot {
    const kind = classifySubscriptionError(error);
    return {
      ...this.snapshot,
      status: kind === 'offline' ? 'offline' : 'error',
      errorMessage: subscriptionErrorMessage(error, kind === 'offline'
        ? 'Premium status could not be refreshed while offline.'
        : 'Premium status could not be refreshed.'),
    };
  }

  async initialize(appUserId: string, onUpdate: (snapshot: SubscriptionSnapshot) => void): Promise<SubscriptionSnapshot> {
    this.onUpdate = onUpdate;
    this.emit(this.initialSnapshot);
    try {
      if (process.env.NODE_ENV !== 'production') await Purchases.setLogLevel(LOG_LEVEL.DEBUG);
      if (!(await Purchases.isConfigured())) {
        Purchases.configure({ apiKey: this.config.apiKey, appUserID: appUserId });
      } else if ((await Purchases.getAppUserID()) !== appUserId) {
        await Purchases.logIn(appUserId);
      }
      this.updateListener = (customerInfo) => this.emit(this.snapshotFor(customerInfo));
      Purchases.addCustomerInfoUpdateListener(this.updateListener);

      const [customerResult, offeringsResult] = await Promise.allSettled([
        Purchases.getCustomerInfo(),
        Purchases.getOfferings(),
      ]);
      const packages = offeringsResult.status === 'fulfilled'
        ? this.setPackages(this.offeringFrom(offeringsResult.value.all, offeringsResult.value.current))
        : [];
      if (customerResult.status === 'rejected') return this.emit(this.failedSnapshot(customerResult.reason));
      const next = this.snapshotFor(customerResult.value, packages);
      if (offeringsResult.status === 'rejected') {
        next.errorMessage = 'Plans could not be loaded. You can retry without losing access.';
      } else if (packages.length === 0) {
        next.errorMessage = this.config.offeringId
          ? `RevenueCat offering "${this.config.offeringId}" has no annual or monthly package.`
          : 'The current RevenueCat offering has no annual or monthly package.';
      }
      return this.emit(next);
    } catch (error) {
      return this.emit(this.failedSnapshot(error));
    }
  }

  async refresh(): Promise<SubscriptionSnapshot> {
    try {
      const [customerInfo, offerings] = await Promise.all([
        Purchases.getCustomerInfo(),
        Purchases.getOfferings(),
      ]);
      const packages = this.setPackages(this.offeringFrom(offerings.all, offerings.current));
      const next = this.snapshotFor(customerInfo, packages);
      if (packages.length === 0) next.errorMessage = 'No annual or monthly package is available in this offering.';
      return this.emit(next);
    } catch (error) {
      return this.emit(this.failedSnapshot(error));
    }
  }

  async purchase(packageId: string): Promise<SubscriptionActionResult> {
    const pkg = this.packageById.get(packageId);
    if (!pkg) {
      return { outcome: 'unavailable', snapshot: this.snapshot, message: 'That plan is not available right now.' };
    }
    try {
      const result = await Purchases.purchasePackage(pkg);
      return completedSubscriptionAction(this.emit(this.snapshotFor(result.customerInfo)));
    } catch (error) {
      if (classifySubscriptionError(error) === 'cancelled') return { outcome: 'cancelled', snapshot: this.snapshot };
      return {
        outcome: 'error',
        snapshot: this.snapshot,
        message: subscriptionErrorMessage(error, 'The purchase could not be completed.'),
      };
    }
  }

  async restore(): Promise<SubscriptionActionResult> {
    try {
      const customerInfo = await Purchases.restorePurchases();
      return completedSubscriptionAction(this.emit(this.snapshotFor(customerInfo)));
    } catch (error) {
      return {
        outcome: 'error',
        snapshot: this.snapshot,
        message: subscriptionErrorMessage(error, 'Purchases could not be restored.'),
      };
    }
  }

  async openManagement(): Promise<SubscriptionActionResult> {
    const url = this.snapshot.managementUrl;
    if (!url) {
      return { outcome: 'unavailable', snapshot: this.snapshot, message: 'There is no active store subscription to manage.' };
    }
    try {
      await Linking.openURL(url);
      return { outcome: 'success', snapshot: this.snapshot };
    } catch (error) {
      return {
        outcome: 'error',
        snapshot: this.snapshot,
        message: subscriptionErrorMessage(error, 'The store subscription page could not be opened.'),
      };
    }
  }

  dispose() {
    if (this.updateListener) Purchases.removeCustomerInfoUpdateListener(this.updateListener);
    this.updateListener = null;
    this.onUpdate = null;
  }
}

export function createSubscriptionClient(): SubscriptionClient {
  const config = readConfig();
  return config ? new RevenueCatClient(config) : unavailableClient();
}
