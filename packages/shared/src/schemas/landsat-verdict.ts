/**
 * M25 (`docs/research/M25-landsat.md` §5): when a Landsat version publishes on its own. A module of its own, which imports nothing at run
 * time, so the admin's approval card carries it in its own chunk (`check_bundle_budget.py`: imported from the shared core it renamed the
 * core's exports, and the join card's chunk outgrew its budget).
 */
import type { LandsatReport } from './landsat.js';

/** A version publishes on its own within this many pixels of Sentinel-2, and with at most this share of the city under cloud. */
export const LANDSAT_MAX_OFFSET_PX = 1;
export const LANDSAT_MAX_CITY_CLOUD_PCT = 10;

/** The report's verdict: measured, within a pixel, a clear city and never moved (lesson 727); anything else waits for Approve. */
export function landsatClear(report: LandsatReport): boolean {
    return (
        report.checked &&
        (report.offsetPx ?? Number.POSITIVE_INFINITY) <= LANDSAT_MAX_OFFSET_PX &&
        report.cityCloudPct <= LANDSAT_MAX_CITY_CLOUD_PCT &&
        report.correction === undefined
    );
}
