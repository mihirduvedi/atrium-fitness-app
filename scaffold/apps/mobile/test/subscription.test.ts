import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canAccessSubscriptionFeature,
  classifySubscriptionError,
  completedSubscriptionAction,
  normalizeSubscriptionPackages,
  shouldShowConversionTeaser,
  subscriptionFromCustomerInfo,
  unconfiguredSubscription,
  type PurchasesPackageLike,
  type SubscriptionFeature,
} from '../src/subscriptions/subscription';

const config = {
  entitlementId: 'atrium_premium',
  offeringId: 'default',
};

afterEach(() => {
  vi.unstubAllEnvs();
});

function customerInfo(active: boolean, periodType: string | null = 'NORMAL') {
  return {
    entitlements: {
      active: active
        ? { atrium_premium: { isActive: true, periodType } }
        : {},
      all: { atrium_premium: { isActive: active, periodType } },
    },
    managementURL: active ? 'https://apps.apple.com/account/subscriptions' : null,
  };
}

describe('subscription access state', () => {
  it('keeps an unconfigured build on the free fallback', () => {
    const state = unconfiguredSubscription();
    expect(state.status).toBe('unconfigured');
    expect(state.configured).toBe(false);
    expect(state.hasPremiumAccess).toBe(false);
    expect(state.packages).toEqual([]);
  });

  it('maps an active free trial to trial access', () => {
    const state = subscriptionFromCustomerInfo(customerInfo(true, 'TRIAL'), config.entitlementId, config.offeringId, []);
    expect(state.status).toBe('trial');
    expect(state.hasPremiumAccess).toBe(true);
  });

  it('maps active paid and expired entitlements correctly', () => {
    const premium = subscriptionFromCustomerInfo(customerInfo(true), config.entitlementId, config.offeringId, []);
    const expired = subscriptionFromCustomerInfo(customerInfo(false), config.entitlementId, config.offeringId, []);
    expect(premium.status).toBe('premium');
    expect(premium.hasPremiumAccess).toBe(true);
    expect(premium.managementUrl).toContain('subscriptions');
    expect(expired.status).toBe('free');
    expect(expired.hasPremiumAccess).toBe(false);
    expect(expired.managementUrl).toBeNull();
  });

  it('treats a paid introductory period as premium rather than a free trial', () => {
    const state = subscriptionFromCustomerInfo(customerInfo(true, 'INTRO'), config.entitlementId, config.offeringId, []);
    expect(state.status).toBe('premium');
    expect(state.hasPremiumAccess).toBe(true);
  });
});

describe('offering normalization', () => {
  it('uses localized annual/monthly prices and ignores unrelated packages', () => {
    const packages: PurchasesPackageLike[] = [
      {
        identifier: '$rc_annual',
        packageType: 'ANNUAL',
        product: {
          identifier: 'atrium_annual',
          price: 69.99,
          priceString: '$69.99',
          pricePerMonthString: '$5.83',
          subscriptionPeriod: 'P1Y',
          introPrice: { price: 0, cycles: 1, periodUnit: 'WEEK', periodNumberOfUnits: 1 },
        },
      },
      {
        identifier: '$rc_monthly',
        packageType: 'MONTHLY',
        product: {
          identifier: 'atrium_monthly',
          price: 9.99,
          priceString: '$9.99',
          subscriptionPeriod: 'P1M',
          introPrice: null,
        },
      },
      {
        identifier: '$rc_weekly',
        packageType: 'WEEKLY',
        product: {
          identifier: 'atrium_weekly',
          price: 3.99,
          priceString: '$3.99',
          subscriptionPeriod: 'P1W',
          introPrice: null,
        },
      },
    ];

    expect(normalizeSubscriptionPackages(packages)).toEqual([
      {
        id: '$rc_annual',
        productId: 'atrium_annual',
        cadence: 'annual',
        title: 'Annual',
        priceString: '$69.99',
        detail: '$5.83 / month',
        trialLabel: '7-day free trial',
      },
      {
        id: '$rc_monthly',
        productId: 'atrium_monthly',
        cadence: 'monthly',
        title: 'Monthly',
        priceString: '$9.99',
        detail: '$9.99 / month',
        trialLabel: null,
      },
    ]);
  });

  it('reads a Google Play free phase from the default subscription option', () => {
    const packages: PurchasesPackageLike[] = [{
      identifier: '$rc_monthly',
      packageType: 'MONTHLY',
      product: {
        identifier: 'atrium_monthly',
        price: 9.99,
        priceString: '$9.99',
        subscriptionPeriod: 'P1M',
        introPrice: null,
        defaultOption: {
          freePhase: {
            billingCycleCount: 1,
            billingPeriod: { unit: 'WEEK', value: 1, iso8601: 'P1W' },
          },
        },
      },
    }];
    expect(normalizeSubscriptionPackages(packages)[0]?.trialLabel).toBe('7-day free trial');
  });
});

describe('purchase and restore outcomes', () => {
  it('separates cancellation, offline errors, and purchase failures', () => {
    expect(classifySubscriptionError({ code: '1', userCancelled: true })).toBe('cancelled');
    expect(classifySubscriptionError({ code: '10' })).toBe('offline');
    expect(classifySubscriptionError({ code: '35' })).toBe('offline');
    expect(classifySubscriptionError({ code: '23' })).toBe('error');
  });

  it('distinguishes a successful restore from no active entitlement', () => {
    const premium = subscriptionFromCustomerInfo(customerInfo(true), config.entitlementId, config.offeringId, []);
    const free = subscriptionFromCustomerInfo(customerInfo(false), config.entitlementId, config.offeringId, []);
    expect(completedSubscriptionAction(premium).outcome).toBe('success');
    expect(completedSubscriptionAction(free).outcome).toBe('no_entitlement');
  });
});

describe('product boundary', () => {
  it('never blocks tracker, history, PR, core progress, or body-data features', () => {
    const freeFeatures: SubscriptionFeature[] = [
      'workout_logger',
      'workout_history',
      'personal_records',
      'progress_core',
      'body_metrics',
      'subjective_tags',
      'starter_programs',
    ];
    expect(freeFeatures.every((feature) => canAccessSubscriptionFeature(feature, false))).toBe(true);
  });

  it('guards only premium coaching and analysis features', () => {
    const premiumFeatures: SubscriptionFeature[] = [
      'coach',
      'weekly_review',
      'adaptive_programming',
      'advanced_analytics',
      'nutrition_signal',
    ];
    expect(premiumFeatures.every((feature) => !canAccessSubscriptionFeature(feature, false))).toBe(true);
    expect(premiumFeatures.every((feature) => canAccessSubscriptionFeature(feature, true))).toBe(true);
  });

  it('allows premium features through the explicit development override', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EXPO_PUBLIC_ATRIUM_DEV_PREMIUM_ACCESS', '1');

    expect(canAccessSubscriptionFeature('coach', false)).toBe(true);
    expect(canAccessSubscriptionFeature('weekly_review', false)).toBe(true);
  });

  it('does not allow the development override to unlock production builds', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EXPO_PUBLIC_ATRIUM_DEV_PREMIUM_ACCESS', '1');

    expect(canAccessSubscriptionFeature('coach', false)).toBe(false);
    expect(canAccessSubscriptionFeature('coach', true)).toBe(true);
  });

  it('waits for five completed workouts before showing the conversion teaser', () => {
    expect(shouldShowConversionTeaser(4, false)).toBe(false);
    expect(shouldShowConversionTeaser(5, false)).toBe(true);
    expect(shouldShowConversionTeaser(12, true)).toBe(false);
  });
});
