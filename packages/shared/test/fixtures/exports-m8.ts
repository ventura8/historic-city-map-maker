/** M8's exports (docs/research/M8-join-interfaces.md §2): the join's schemas, the plan of the dates, its callable. */
export const M8_EXPORTS: readonly string[] = [
    'DATE_PLAN_MAX_ROWS',
    'datePlanDocSchema',
    'datePlanRowSchema',
    'imageryJoinRequestSchema',
    'imageryJoinResponseSchema',
    'joinPartSchema',
    'joinReportSchema',
    'joinSeamSchema',
    'joinSourceSchema',
    'layerJoinParamsSchema',
    'planDate',
    'planDates',
    // The owner's report of 2026-11-13 (DECISIONS §201): the plan's cloudy frames, Not useful, and the browse copy's larger fetch.
    'BROWSE_FETCH_MAX_BYTES',
    'BROWSE_LONG_EDGE',
    'CLOUDY_CITY_PERCENT',
    'CLOUD_ESTIMATE_VERSION',
    'UNUSABLE_REASONS',
    'cloudEstimateSchema',
];
