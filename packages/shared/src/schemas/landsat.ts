/**
 * M25 (`docs/research/M25-landsat.md`): Landsat over the city. Collection 2 Level-1 scenes come through the same USGS M2M API as the
 * declassified frames, already georeferenced (UTM) and public domain: the harvest searches them in leaf-on months under a cloud
 * cap, the ranking adds the season to the cloud part, the tick imports the best scene of each wanted year on its own (the
 * daily cap counts it as any cloud import), and the pipeline composes true colour (and pan-sharpens ETM+ and OLI to 15 m) instead of
 * georeferencing. What the pipeline measured is the version's `landsat` report; a version publishes on its own only when it
 * lies within a pixel of Sentinel-2 and the city is clear.
 */
import { z } from 'zod';

import { LANDSAT_DATASETS, type USGS_DATASETS as DATASETS } from './firestore.js';

// The lists and the settings' years, re-exported here so the package's index names them in one line.
export { DECLASS_DATASETS, LANDSAT_DATASETS, USGS_DATASETS } from './firestore.js';
export { DEFAULT_LANDSAT_YEARS, landsatYearsOf } from './imagery-settings.js';

type Dataset = (typeof DATASETS)[number];
export type LandsatDataset = (typeof LANDSAT_DATASETS)[number];

/** The credit every Landsat layer carries (public domain; the credit is the one NASA and USGS ask for). */
export const LANDSAT_ATTRIBUTION = 'Landsat imagery courtesy of NASA Goddard Space Flight Center and U.S. Geological Survey';

/** Landsat 7's scan line corrector failed on 2003-05-31: every later ETM+ scene has wedge-shaped gaps, so the harvest stops before. */
export const ETM_SLC_OFF_DATE = '2003-05-31';

/** The months the harvest searches (M2M `seasonalFilter`): May to September; June to August are leaf-on and rank first. */
export const LANDSAT_MONTHS = [5, 6, 7, 8, 9] as const;
export const LEAF_ON_MONTHS: readonly number[] = [6, 7, 8];

/** The harvest keeps scenes at most this cloudy (M2M `cloudCoverFilter`), and the tick imports one at most this cloudy. */
export const LANDSAT_SEARCH_MAX_CLOUD = 40;
export const LANDSAT_AUTO_MAX_CLOUD = 20;

/** The tick starts at most this many Landsat imports a city per run in the cloud; the daily cap still counts each. */
export const LANDSAT_AUTO_PER_TICK = 1;
/** While the city's computers run the worker: one import per online worker, at most this many a run (placed there: never capped). */
export const LANDSAT_AUTO_MAX_PER_TICK = 4;

const LANDSAT_SET: ReadonlySet<string> = new Set(LANDSAT_DATASETS);

/** True for a Landsat dataset (never a declassified one). */
export function isLandsatDataset(dataset: Dataset): dataset is LandsatDataset {
    return LANDSAT_SET.has(dataset);
}

/**
 * `layerVersions/{version}.landsat`: what the pipeline's `warp` measured of a Landsat scene. `offsetPx` and `offsetM` are the shift
 * against the Sentinel-2 reference (absent when it could not be measured: `checked` false), `cityCloudPct` the share of the city's
 * pixels the scene's own quality band calls cloud (and, lesson 726, where a colour band saturated), `pansharpened` an ETM+ scene brought
 * to 15 m with its panchromatic band. `correction` (lesson 727): a systematic scene (USGS's L1GS or L1GT, placed only by the
 * satellite's orbit) found over a pixel off was `applied` (moved by `eastM` and `northM`, the shift then measured again within a pixel:
 * the offset fields are what is left) or `refused` (`implausible`: farther than such a scene can be off; `unconfirmed`: the second
 * measure did not agree); a scene with a correction always waits for an admin.
 */
const landsatCorrectionSchema = z.strictObject({
    state: z.enum(['applied', 'refused']),
    eastM: z.number().min(-1_000_000).max(1_000_000),
    northM: z.number().min(-1_000_000).max(1_000_000),
    reason: z.enum(['implausible', 'unconfirmed']).optional(),
});

export const landsatReportSchema = z.strictObject({
    checked: z.boolean(),
    offsetPx: z.number().min(0).max(10_000).optional(),
    offsetM: z.number().min(0).max(1_000_000).optional(),
    eastM: z.number().min(-1_000_000).max(1_000_000).optional(),
    northM: z.number().min(-1_000_000).max(1_000_000).optional(),
    cityCloudPct: z.number().min(0).max(100),
    resolutionM: z.number().positive().max(100),
    pansharpened: z.boolean(),
    correction: landsatCorrectionSchema.optional(),
});

export type LandsatReport = z.infer<typeof landsatReportSchema>;
