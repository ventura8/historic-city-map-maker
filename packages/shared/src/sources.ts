/**
 * M28 (`docs/research/M28-sources.md`): the map's sources, what each one is and costs, and the app's platform, as the entry
 * `@hcm/shared/sources` (the package's main entry is at its size limit; the public viewer imports none of this).
 */
export { DEFAULT_SOURCES, REQUIRED_SOURCES, SOURCE_TOGGLES, citySourcesSchema, needsUsgsAccount, sourcesOf } from './schemas/sources.js';
export type { CitySources, RequiredSource, SourceChoices, SourceId, SourceToggle } from './schemas/sources.js';
export {
    GUIDED_CATALOGUE,
    GUIDED_SOURCES,
    NOT_USABLE_SOURCES,
    ONE_SCAN_USD,
    PLATFORM_LINKS,
    PLATFORM_MONTHLY_USD,
} from './schemas/sources-catalogue.js';
export {
    PLATFORM_SECTIONS,
    SOURCE_CATALOGUE,
    SOURCES_CHECKED_ON,
    sourceFacts,
    sourceOn,
    sourcesEstimate,
} from './schemas/sources-catalogue.js';
export type { GuidedFacts, GuidedSource, ImportPath, NotUsableSource, PlatformSection, PublicUse } from './schemas/sources-catalogue.js';
export type { SourceAccount, SourceFacts, SourceGroup, SourceLink, SourcesEstimate, UsdRange } from './schemas/sources-catalogue.js';
export {
    COUNTRY_SOURCES_REFRESH_DAYS,
    IMPORT_ROUTES,
    PLACE_KINDS,
    PLACE_MATERIALS,
    countryPlaceSchema,
    countrySourcesDocSchema,
    countrySourcesDue,
    directionsUrl,
    requestMailUrl,
} from './schemas/country-sources.js';
export type { CountryPlace, CountrySourcesDoc, ImportRoute, PlaceKind, PlaceMaterial, PlaceRequest } from './schemas/country-sources.js';
export { TRANSLATION_CATALOGUE, TRANSLATION_CHECKED_ON, TRANSLATION_OPTIONS } from './schemas/translation-sources.js';
export type { FreeLimit, TranslationFacts, TranslationOption } from './schemas/translation-sources.js';
