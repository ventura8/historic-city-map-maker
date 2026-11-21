/**
 * A city's imagery settings (`cities/{city}.imagery`, `docs/research/M3-interfaces.md` §5): whether a georeferenced
 * scene goes to the public map on its own when its checkpoint error is small enough, that threshold, and the years the
 * city most wants historical layers of (the ranking's "target years"). A leaf module: `firestore.ts` imports it for the
 * city document, so it imports nothing of the document schemas.
 */
import { z } from 'zod';

import { coded, yearSchema } from './primitives.js';

/**
 * The checkpoint RMSE, in metres on the ground, under which a georeferenced scene is published without anyone's click
 * (about a street's width: KH-4A frames resolve about 2.75 m, KH-9 mapping frames 6 to 9 m).
 */
export const DEFAULT_RMSE_THRESHOLD_M = 15;

/** The bounds an admin may set the threshold to. */
export const RMSE_THRESHOLD_RANGE = { min: 1, max: 200 } as const;

/** At most this many target years per city. */
export const MAX_TARGET_YEARS = 20;

/**
 * M8 (`docs/research/M8-join-interfaces.md` §2): at most this many frames of one date join into one layer. Here because
 * this module is a leaf: the layer document (`firestore.ts`) and the join's schemas (`imagery-join.ts`) both read it.
 */
export const JOIN_MAX_PARTS = 8;

/**
 * M9 (`docs/research/M9-calibration.md` §11): the share of the city a USGS frame or a join must cover to publish on its own, and
 * under which the admin is offered the date's other frames. One bar, here because this module is a leaf.
 */
export const CITY_MIN_COVERAGE_PCT = 90;

/**
 * M9: a frame publishes itself only when its agreeing tiles span at least this share of what it covers of the window (real frames: see
 * `docs/research/M9-calibration.md` §14). Beyond them a polynomial extrapolates, and no check looks there.
 */
export const AUTO_MIN_MEASURED_PCT = 70;

/**
 * M20 (`docs/research/M20-import-local.md` §5, the owner's decision of 2026-11-09): the most a drawn map's threshold may grow to by
 * default (1 mm of its paper, never under the city's own), and the bounds an owner may set it to. Here because this module is a leaf.
 */
export const DEFAULT_MAP_THRESHOLD_MAX_M = 60;
export const MAP_THRESHOLD_MAX_RANGE = { min: 15, max: 200 } as const;

/**
 * M25 (`docs/research/M25-landsat.md` §4): the years the tick imports a Landsat scene of on its own by default: from 1984 to the current
 * year (the owner, 2026-11-13; 1984 to 2000 before, when only TM and early ETM+ were searched). `to` absent is "up to this year": a city
 * that set no end gets each new year by itself. Here because this module is a leaf.
 */
export const DEFAULT_LANDSAT_YEARS: { readonly from: number; readonly to?: number } = { from: 1984 };

/**
 * `cities/{city}.imagery`. Every field is optional in the document: an absent field takes its default
 * ({@link imagerySettingsOf}), so a city created before M3 needs no migration.
 */
export const cityImagerySchema = z.strictObject({
    /** True (the default): a version under the threshold is approved and published without a click. */
    autoPublish: z.boolean().optional(),
    rmseThresholdM: z.number().min(RMSE_THRESHOLD_RANGE.min).max(RMSE_THRESHOLD_RANGE.max).optional(),
    /** The years the city wants first (București: 1966, 1976, 1977, 1978, 1980); distinct, any order. */
    targetYears: z
        .array(yearSchema)
        .max(MAX_TARGET_YEARS)
        .refine((years) => new Set(years).size === years.length, coded('validation.duplicateId'))
        .optional(),
    /**
     * M12 (`docs/research/M12-own-tiles.md`): true keeps Mapbox's publishing path for this city; false or absent (the default) serves
     * the tiles from the project's own public bucket, with no Mapbox compute units, tileset or token.
     */
    publishThroughMapbox: z.boolean().optional(),
    /** M20 (§5): the cap of a drawn map's scaled threshold (default 60 m). */
    mapThresholdMaxM: z.number().min(MAP_THRESHOLD_MAX_RANGE.min).max(MAP_THRESHOLD_MAX_RANGE.max).optional(),
    /** M20 (§5): true (the default): a drawn map within its scaled threshold, its rights clear, publishes without a click. */
    mapAutoPublish: z.boolean().optional(),
    /** M25: true (the default): `imagery.tick` imports the best Landsat scene of each year from `landsatFrom` to `landsatTo`. */
    landsatAuto: z.boolean().optional(),
    landsatFrom: yearSchema.optional(),
    landsatTo: yearSchema.optional(),
});

export type CityImagery = z.infer<typeof cityImagerySchema>;

/** The settings with every default applied. */
export interface ImagerySettings {
    readonly autoPublish: boolean;
    readonly rmseThresholdM: number;
    readonly targetYears: readonly number[];
    readonly publishThroughMapbox: boolean;
    readonly mapThresholdMaxM: number;
    readonly mapAutoPublish: boolean;
    readonly landsatAuto: boolean;
    readonly landsatFrom: number;
    /** M25: the last year, or undefined for up to the current year (the default). */
    readonly landsatTo: number | undefined;
}

/** What a city that set nothing gets: auto-publish, the default threshold, no target years, tiles from its own bucket. */
const DEFAULT_SETTINGS: ImagerySettings = {
    autoPublish: true,
    rmseThresholdM: DEFAULT_RMSE_THRESHOLD_M,
    targetYears: [],
    publishThroughMapbox: false,
    mapThresholdMaxM: DEFAULT_MAP_THRESHOLD_MAX_M,
    mapAutoPublish: true,
    landsatAuto: true,
    landsatFrom: DEFAULT_LANDSAT_YEARS.from,
    landsatTo: DEFAULT_LANDSAT_YEARS.to,
};

function setting<K extends keyof ImagerySettings>(imagery: CityImagery | undefined, key: K): ImagerySettings[K] {
    return (imagery?.[key] as ImagerySettings[K] | undefined) ?? DEFAULT_SETTINGS[key];
}

/** A city's settings with the defaults filled in. */
export function imagerySettingsOf(imagery: CityImagery | undefined): ImagerySettings {
    return {
        autoPublish: setting(imagery, 'autoPublish'),
        rmseThresholdM: setting(imagery, 'rmseThresholdM'),
        targetYears: setting(imagery, 'targetYears'),
        publishThroughMapbox: setting(imagery, 'publishThroughMapbox'),
        mapThresholdMaxM: setting(imagery, 'mapThresholdMaxM'),
        mapAutoPublish: setting(imagery, 'mapAutoPublish'),
        landsatAuto: setting(imagery, 'landsatAuto'),
        landsatFrom: setting(imagery, 'landsatFrom'),
        landsatTo: setting(imagery, 'landsatTo'),
    };
}

/** M25: the years the tick imports Landsat of, oldest first, never past `thisYear` (none when the range is reversed). */
export function landsatYearsOf(settings: Pick<ImagerySettings, 'landsatFrom' | 'landsatTo'>, thisYear: number): number[] {
    const last = Math.min(settings.landsatTo ?? thisYear, thisYear);
    const count = Math.max(0, last - settings.landsatFrom + 1);
    return Array.from({ length: count }, (_, index) => settings.landsatFrom + index);
}
