/**
 * `firebase/analytics`, in its own lazily imported module (`loadAnalyticsSdk` in `app.ts`): the ES build emits it as a
 * separate chunk, fetched only once the admin consented and a measurement id exists (the IIFE build inlines it).
 */
import { initializeAnalytics, isSupported, logEvent, setAnalyticsCollectionEnabled, setConsent } from 'firebase/analytics';

export const analyticsSdk = { isSupported, setConsent, initializeAnalytics, logEvent, setAnalyticsCollectionEnabled };
