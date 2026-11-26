/**
 * The viewer's field chunk (docs/research/DECISIONS-for-review.md §76), lazily imported beside `firebase-sdk.ts` once the
 * visitor consented: Google's `web-vitals` (its attribution build, the only module of the engine that imports it,
 * `.dependency-cruiser.cjs`) and the event guard of `@hcm/shared`. The ES module build emits it as its own file,
 * fetched only after consent; the IIFE build inlines it (as it does the Firebase SDK, docs/research/M1-interfaces.md CR-10).
 */
import { createViewerGuard, observeWebVitals, type FieldChunk } from '@hcm/shared';
import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals/attribution';

export const fieldSdk: FieldChunk = {
    createGuard: createViewerGuard,
    observeVitals: (report) => {
        observeWebVitals([onLCP, onINP, onCLS, onFCP, onTTFB], report);
    },
};
