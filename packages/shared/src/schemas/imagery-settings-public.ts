export {
    AUTO_MIN_MEASURED_PCT,
    CITY_MIN_COVERAGE_PCT,
    DEFAULT_RMSE_THRESHOLD_M,
    DEFAULT_SUPERSEDED_TILES_RETENTION_DAYS,
    JOIN_MAX_PARTS,
    SUPERSEDED_TILES_RETENTION_DAYS_RANGE,
    MAX_TARGET_YEARS,
    RMSE_THRESHOLD_RANGE,
    cityImagerySchema,
    imagerySettingsOf,
} from './imagery-settings.js';
export type { CityImagery, ImagerySettings } from './imagery-settings.js';

// M25 (docs/research/M25-landsat.md): named, never `export *` (a star re-export costs the engine bytes: docs/LESSONS.md 532).
export { DECLASS_DATASETS, DEFAULT_LANDSAT_YEARS, ETM_SLC_OFF_DATE, LANDSAT_ATTRIBUTION } from './landsat.js';
export { LANDSAT_AUTO_MAX_CLOUD, LANDSAT_AUTO_MAX_PER_TICK, LANDSAT_AUTO_PER_TICK, LANDSAT_DATASETS } from './landsat.js';
export { LANDSAT_MAX_CITY_CLOUD_PCT, LANDSAT_MAX_OFFSET_PX, landsatClear } from './landsat-verdict.js';
export { LANDSAT_MONTHS, LANDSAT_SEARCH_MAX_CLOUD, LEAF_ON_MONTHS, USGS_DATASETS } from './landsat.js';
export { isLandsatDataset, landsatReportSchema, landsatYearsOf } from './landsat.js';
export type * from './landsat.js';
