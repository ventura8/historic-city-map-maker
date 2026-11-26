/**
 * The Firebase SDK modules of the viewer, in one lazily imported chunk (`loadFirebaseSdk` in `telemetry.ts`): only
 * firebase/app and firebase/analytics, never a data SDK (the viewer never reads Firestore) and never Performance
 * Monitoring (it would send the URL hash: docs/research/DECISIONS-for-review.md §18a). The ES module build emits this
 * as its own file, fetched only after consent; see docs/research/M1-interfaces.md CR-10 for the IIFE build.
 */
import { initializeApp } from 'firebase/app';
import { initializeAnalytics, isSupported, logEvent, setAnalyticsCollectionEnabled, setConsent } from 'firebase/analytics';

import type { FirebaseSdk } from './analytics.js';

export const firebaseSdk: FirebaseSdk = {
    initializeApp,
    isSupported,
    setConsent,
    initializeAnalytics,
    logEvent,
    setAnalyticsCollectionEnabled,
};
