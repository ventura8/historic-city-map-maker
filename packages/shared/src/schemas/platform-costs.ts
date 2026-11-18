/**
 * The app platform's monthly cost band and one scan's price (M28). A leaf module: Home's Monthly costs card only needs
 * these figures, and importing them from `sources-catalogue.ts` shared that catalogue with Setup's Sources card in
 * `editor-shared`.
 */
import { orderEstimateUsd } from './usgs-order.js';

/** A monthly cost estimate in US dollars. */
export interface UsdRange {
    readonly low: number;
    readonly high: number;
}

/**
 * The app's platform, always on and not a source: Setup's billing card says "The Blaze plan charges only for use beyond
 * the free tier: about USD 0.5–2 a month".
 */
export const PLATFORM_MONTHLY_USD: UsdRange = { low: 0.5, high: 2 };

/** One frame scanned on demand, in one order (USD 30 a frame plus USD 5 an order, `usgs-order.ts`). */
export const ONE_SCAN_USD = orderEstimateUsd(1);
