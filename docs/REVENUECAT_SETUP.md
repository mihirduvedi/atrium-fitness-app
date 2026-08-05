# RevenueCat setup

Atrium uses `react-native-purchases` behind a local subscription boundary. The free tracker remains usable when RevenueCat is unconfigured, offline, or unable to load an offering.

## Dashboard contract

Create the real identifiers in RevenueCat and the stores; do not copy placeholder identifiers into production:

- One iOS app matching bundle identifier `app.atrium.mobile.mihir`.
- One Android app matching package `app.atrium.mobile`.
- One entitlement for Atrium Premium.
- Monthly and annual subscription products attached to that entitlement.
- A 7-day trial configured on the store products if that remains the launch offer.
- An offering containing RevenueCat's standard monthly and annual packages. Mark it current, or provide its identifier explicitly.

The paywall displays localized store prices and trial metadata returned by the offering. The product-direction amounts in the design reference are not hardcoded transactional prices.

## Local configuration

Copy `apps/mobile/.env.example` to `apps/mobile/.env` and set:

```dotenv
EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=
EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=
EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID=
EXPO_PUBLIC_REVENUECAT_OFFERING_ID=
```

Only public RevenueCat SDK keys belong in Expo `EXPO_PUBLIC_` variables. Never add a RevenueCat secret API key. The offering variable is optional; an empty value uses RevenueCat's current offering.

## Native builds

Real purchases require a rebuilt Expo development client, TestFlight/App Store build, or Play test build. Expo Go can preview subscription code but cannot complete real store transactions.

After adding or updating the SDK, rebuild the native client:

```bash
npm run ios --workspace mobile
npm run android --workspace mobile
```

Before store testing:

- Enable In-App Purchase for the iOS target and finish App Store Connect agreements, products, and sandbox tester setup.
- Confirm Android billing permission is present in the merged manifest, keep the main activity launch mode at `standard` or `singleTop`, and configure Play Console products and license testers.
- Use the platform-specific public SDK key for release builds. Never submit a Test Store key to an app store.

Current official references:

- [RevenueCat with Expo](https://www.revenuecat.com/docs/getting-started/installation/expo)
- [React Native SDK installation](https://www.revenuecat.com/docs/getting-started/installation/reactnative)
- [Configuring the SDK](https://www.revenuecat.com/docs/getting-started/configuring-sdk)
- [Subscription status and offline cache](https://www.revenuecat.com/docs/customers/customer-info)
- [Managing subscriptions](https://www.revenuecat.com/docs/subscription-guidance/managing-subscriptions)

## QA boundary

Automated tests cover subscription-state mapping, offering normalization, cancellation/error handling, restore outcomes, conversion timing, and the free/premium feature boundary. They do not prove store configuration or a native purchase.

Complete native sandbox QA on iOS and Android before release: offering load, localized prices, selection, cancellation, trial/purchase unlock, restore, restart persistence, offline launch, management link, and clean paywall dismissal.
