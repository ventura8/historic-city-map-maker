/**
 * Why the Statistics view's numbers could not be read when it is not one of Google's own failures (§203): no GA4
 * property at all (no access) or none that receives the map's measurement id. A module of its own, so the crashes page
 * imports it without the lazy `analytics-data` chunk.
 */
export class StatisticsProblem extends Error {
    constructor(readonly problem: 'noAccess' | 'noProperty') {
        super(`statistics: ${problem}`);
        this.name = 'StatisticsProblem';
    }
}
