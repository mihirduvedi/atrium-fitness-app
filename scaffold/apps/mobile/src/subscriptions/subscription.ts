export type SubscriptionStatus =
  | 'unconfigured'
  | 'loading'
  | 'free'
  | 'trial'
  | 'premium'
  | 'offline'
  | 'error';

export type SubscriptionCadence = 'annual' | 'monthly';

export interface SubscriptionPackage {
  id: string;
  productId: string;
  cadence: SubscriptionCadence;
  title: string;
  priceString: string;
  detail: string;
  trialLabel: string | null;
}

export interface SubscriptionSnapshot {
  status: SubscriptionStatus;
  configured: boolean;
  hasPremiumAccess: boolean;
  entitlementId: string | null;
  offeringId: string | null;
  packages: SubscriptionPackage[];
  managementUrl: string | null;
  errorMessage: string | null;
}

export type SubscriptionActionOutcome =
  | 'success'
  | 'cancelled'
  | 'no_entitlement'
  | 'unavailable'
  | 'error';

export interface SubscriptionActionResult {
  outcome: SubscriptionActionOutcome;
  snapshot?: SubscriptionSnapshot;
  message?: string;
}

export interface SubscriptionErrorLike {
  code?: string | number | null;
  message?: string | null;
  userCancelled?: boolean | null;
}

export type SubscriptionErrorKind = 'cancelled' | 'offline' | 'error';

export interface CustomerInfoLike {
  entitlements?: {
    active?: Record<string, EntitlementLike | undefined>;
    all?: Record<string, EntitlementLike | undefined>;
  };
  managementURL?: string | null;
}

export interface EntitlementLike {
  isActive?: boolean;
  periodType?: string | null;
}

export interface PurchasesPackageLike {
  identifier: string;
  packageType: string;
  product: {
    identifier: string;
    title?: string;
    price: number;
    priceString: string;
    pricePerMonthString?: string | null;
    subscriptionPeriod?: string | null;
    introPrice?: {
      price: number;
      cycles: number;
      period?: string;
      periodUnit?: string;
      periodNumberOfUnits?: number;
    } | null;
    defaultOption?: {
      freePhase?: {
        billingCycleCount?: number | null;
        billingPeriod: {
          unit: string;
          value: number;
          iso8601?: string;
        };
      } | null;
    } | null;
  };
}

export type SubscriptionFeature =
  | 'workout_logger'
  | 'workout_history'
  | 'personal_records'
  | 'progress_core'
  | 'body_metrics'
  | 'subjective_tags'
  | 'starter_programs'
  | 'coach'
  | 'weekly_review'
  | 'adaptive_programming'
  | 'advanced_analytics'
  | 'nutrition_signal';

const PREMIUM_FEATURES = new Set<SubscriptionFeature>([
  'coach',
  'weekly_review',
  'adaptive_programming',
  'advanced_analytics',
  'nutrition_signal',
]);

export function unconfiguredSubscription(message = 'Subscriptions are not configured in this build.'): SubscriptionSnapshot {
  return {
    status: 'unconfigured',
    configured: false,
    hasPremiumAccess: false,
    entitlementId: null,
    offeringId: null,
    packages: [],
    managementUrl: null,
    errorMessage: message,
  };
}

export function loadingSubscription(entitlementId: string, offeringId: string | null): SubscriptionSnapshot {
  return {
    status: 'loading',
    configured: true,
    hasPremiumAccess: false,
    entitlementId,
    offeringId,
    packages: [],
    managementUrl: null,
    errorMessage: null,
  };
}

export function subscriptionFromCustomerInfo(
  customerInfo: CustomerInfoLike,
  entitlementId: string,
  offeringId: string | null,
  packages: SubscriptionPackage[],
): SubscriptionSnapshot {
  const entitlement = customerInfo.entitlements?.active?.[entitlementId]
    ?? customerInfo.entitlements?.all?.[entitlementId];
  const hasPremiumAccess = entitlement?.isActive === true;
  const periodType = entitlement?.periodType?.toUpperCase();
  const status: SubscriptionStatus = hasPremiumAccess
    ? periodType === 'TRIAL'
      ? 'trial'
      : 'premium'
    : 'free';
  return {
    status,
    configured: true,
    hasPremiumAccess,
    entitlementId,
    offeringId,
    packages,
    managementUrl: customerInfo.managementURL ?? null,
    errorMessage: null,
  };
}

function cadenceFor(pkg: PurchasesPackageLike): SubscriptionCadence | null {
  const packageType = pkg.packageType.toUpperCase();
  const period = pkg.product.subscriptionPeriod?.toUpperCase();
  if (packageType === 'ANNUAL' || period === 'P1Y' || period === 'P12M') return 'annual';
  if (packageType === 'MONTHLY' || period === 'P1M') return 'monthly';
  return null;
}

function freeTrialLabel(pkg: PurchasesPackageLike): string | null {
  const intro = pkg.product.introPrice;
  const googleFreePhase = pkg.product.defaultOption?.freePhase;
  if ((!intro || intro.price !== 0) && !googleFreePhase) return null;
  if (googleFreePhase) {
    const cycles = Math.max(1, Math.round(googleFreePhase.billingCycleCount || 1));
    const units = Math.max(1, Math.round(googleFreePhase.billingPeriod.value || 1)) * cycles;
    const unit = googleFreePhase.billingPeriod.unit.toUpperCase();
    if (unit === 'DAY') return `${units}-day free trial`;
    if (unit === 'WEEK') return `${units * 7}-day free trial`;
    if (unit === 'MONTH') return `${units}-month free trial`;
    if (unit === 'YEAR') return `${units}-year free trial`;
  }
  if (!intro) return 'Free trial';
  const cycles = Math.max(1, Math.round(intro.cycles || 1));
  const units = Math.max(1, Math.round(intro.periodNumberOfUnits || 1)) * cycles;
  const unit = intro.periodUnit?.toUpperCase();
  if (unit === 'DAY') return `${units}-day free trial`;
  if (unit === 'WEEK') return `${units * 7}-day free trial`;
  if (unit === 'MONTH') return `${units}-month free trial`;
  if (unit === 'YEAR') return `${units}-year free trial`;

  const period = intro.period?.toUpperCase();
  const match = period?.match(/^P(\d+)([DWMY])$/);
  if (!match) return 'Free trial';
  const amount = Number(match[1]) * cycles;
  if (match[2] === 'W') return `${amount * 7}-day free trial`;
  if (match[2] === 'D') return `${amount}-day free trial`;
  if (match[2] === 'M') return `${amount}-month free trial`;
  return `${amount}-year free trial`;
}

export function normalizeSubscriptionPackages(packages: PurchasesPackageLike[]): SubscriptionPackage[] {
  const seen = new Set<SubscriptionCadence>();
  const normalized: SubscriptionPackage[] = [];
  for (const pkg of packages) {
    const cadence = cadenceFor(pkg);
    if (!cadence || seen.has(cadence)) continue;
    seen.add(cadence);
    normalized.push({
      id: pkg.identifier,
      productId: pkg.product.identifier,
      cadence,
      title: cadence === 'annual' ? 'Annual' : 'Monthly',
      priceString: pkg.product.priceString,
      detail: cadence === 'annual'
        ? pkg.product.pricePerMonthString
          ? `${pkg.product.pricePerMonthString} / month`
          : `${pkg.product.priceString} / year`
        : `${pkg.product.priceString} / month`,
      trialLabel: freeTrialLabel(pkg),
    });
  }
  return normalized.sort((a, b) => (a.cadence === b.cadence ? 0 : a.cadence === 'annual' ? -1 : 1));
}

export function classifySubscriptionError(error: unknown): SubscriptionErrorKind {
  const candidate = typeof error === 'object' && error !== null ? error as SubscriptionErrorLike : null;
  const code = candidate?.code == null ? '' : String(candidate.code);
  if (candidate?.userCancelled === true || code === '1') return 'cancelled';
  if (code === '10' || code === '35') return 'offline';
  return 'error';
}

export function subscriptionErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

export function completedSubscriptionAction(snapshot: SubscriptionSnapshot): SubscriptionActionResult {
  if (snapshot.hasPremiumAccess) return { outcome: 'success', snapshot };
  return {
    outcome: 'no_entitlement',
    snapshot,
    message: 'No active Atrium Premium purchase was found for this store account.',
  };
}

export function canAccessSubscriptionFeature(feature: SubscriptionFeature, hasPremiumAccess: boolean): boolean {
  const developmentPremiumAccess = process.env.NODE_ENV !== 'production'
    && process.env.EXPO_PUBLIC_ATRIUM_DEV_PREMIUM_ACCESS === '1';
  return !PREMIUM_FEATURES.has(feature) || hasPremiumAccess || developmentPremiumAccess;
}

export function shouldShowConversionTeaser(completedWorkouts: number, hasPremiumAccess: boolean): boolean {
  return !hasPremiumAccess && completedWorkouts >= 5;
}

export function subscriptionStatusLabel(snapshot: SubscriptionSnapshot): string {
  if (snapshot.status === 'trial') return 'Trial active';
  if (snapshot.status === 'premium') return 'Premium';
  if (snapshot.status === 'loading') return 'Checking';
  if (snapshot.status === 'offline') return snapshot.hasPremiumAccess ? 'Premium · offline' : 'Offline';
  if (snapshot.status === 'error') return 'Unavailable';
  if (snapshot.status === 'unconfigured') return 'Setup needed';
  return 'Free';
}
