/**
 * M29 (`docs/research/M29-imagery-census.md`): the imagery census and its texts, as the entry `@hcm/shared/census` (the
 * package's main entry is at its size limit; the public viewer imports none of this).
 */
export {
    CENSUS_DECADES,
    CENSUS_ESTIMATE_CHECKED_ON,
    CENSUS_MAX_CLOUD,
    CENSUS_MAX_PAGES,
    CENSUS_ORIGIN,
    CENSUS_SEARCH_URL,
    CensusError,
    DECLASSIFIED_SCANNED,
    DECLASSIFIED_TO_SCAN,
    imageryCensus,
} from './schemas/imagery-census.js';
export type { CensusBox, CensusFailure, CensusFetch, CensusPreview, CountRange, ImageryCensus } from './schemas/imagery-census.js';
export { translateCensus, type CensusKey } from './i18n/census/index.js';
