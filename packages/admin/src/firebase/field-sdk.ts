/**
 * The admin's field chunk (docs/research/DECISIONS-for-review.md §76), lazily imported beside `analytics-sdk.ts` once the
 * admin consented (`loadFieldSdk` in `app.ts`): Google's `web-vitals` (its attribution build, the only module of the
 * admin that imports it, `.dependency-cruiser.cjs`) and the event guard of `@hcm/shared`. The ES build emits it as its own
 * chunk.
 */
import { createAdminGuard, observeWebVitals, type FieldChunk } from '@hcm/shared';
import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals/attribution';

export const fieldSdk: FieldChunk = {
    createGuard: createAdminGuard,
    observeVitals: (report) => {
        observeWebVitals([onLCP, onINP, onCLS, onFCP, onTTFB], report);
    },
};
