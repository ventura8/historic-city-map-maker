/**
 * What the harvest keeps of an M2M `scene-search` record (`docs/research/M3-interfaces.md` §3.2): the frame's dates, its
 * footprint and corners, its camera, its coverage of the city (a KH-9 panoramic frame's by its camera's outline, the stored
 * footprint staying what USGS says), whether it is already scanned and its browse address on USGS's own host. The metadata field names of the camera and the corners are **UNVERIFIED** (the fixtures define them;
 * the first real search over Bucharest proves them, §14).
 */
import {
    ARGON_FRAME_ID,
    SENSOR_SPECS,
    footprintCoverage,
    footprintOf,
    isId,
    usgsBrowseUrlSchema,
    validate,
    type BoundsRecord,
    type Sensor,
    type UsgsDataset,
    type UsgsSceneDoc,
} from '@hcm/shared';

import type { UsgsScenes } from '../ports/usgs-scenes.js';

export type SceneRecord = Awaited<ReturnType<UsgsScenes['search']>>['records'][number];

/** The fields of a scene document that come from its record (the harvest adds the status, rank, browse and stamp). */
export type SceneFields = Pick<
    UsgsSceneDoc,
    'entityId' | 'dataset' | 'sensor' | 'acquisitionDate' | 'downloadAvailable' | 'footprint' | 'resolutionM' | 'coverage'
> &
    Partial<Pick<UsgsSceneDoc, 'displayId' | 'corners' | 'cloudCover'>>;

/** The camera field of the full metadata (UNVERIFIED name). */
const CAMERA_FIELD = 'Camera Type';

/** Each dataset's cameras by how the metadata spells them, and the camera when it says none. */
const CAMERAS: Readonly<
    Record<
        UsgsDataset,
        {
            readonly patterns: readonly (readonly [RegExp, Sensor])[];
            /** What a frame's id says when the metadata does not: a real Argon frame, DS09065A089MC039, fell through to KH-4A. */
            readonly ids: readonly (readonly [RegExp, Sensor])[];
            readonly fallback: Sensor;
        }
    >
> = {
    corona2: {
        patterns: [
            [/KH-?4B/i, 'KH-4B'],
            [/KH-?4A/i, 'KH-4A'],
            [/KH-?4(?![A-Z])/i, 'KH-4'],
            [/KH-?5|ARGON/i, 'KH-5'],
        ],
        // Mission numbers: Argon 9xxxA (MC, its mapping camera), KH-4B 11xx, KH-4A 10xx, KH-4 9xxx.
        ids: [
            [ARGON_FRAME_ID, 'KH-5'],
            [/^DS0*11\d{2}/i, 'KH-4B'],
            [/^DS0*10\d{2}/i, 'KH-4A'],
            [/^DS0*9\d{3}/i, 'KH-4'],
        ],
        fallback: 'KH-4A',
    },
    declassii: {
        patterns: [
            [/KH-?7/i, 'KH-7'],
            [/KH-?9/i, 'KH-9-mapping'],
        ],
        // H: the high-resolution KH-7, L: the lower-resolution KH-9 mapping camera.
        ids: [
            [/^DZB[\d-]+H\d+$/i, 'KH-7'],
            [/^DZB[\d-]+L\d+$/i, 'KH-9-mapping'],
        ],
        fallback: 'KH-9-mapping',
    },
    declassiii: { patterns: [], ids: [], fallback: 'KH-9-pan' },
    // M25: the satellite is in the entity id (`LT51830291989193MTI00`) and the product id (`LT05_L1TP_...`).
    landsat_tm_c2_l1: {
        patterns: [],
        ids: [
            [/^LT0?4/i, 'L4-TM'],
            [/^LT0?5/i, 'L5-TM'],
        ],
        fallback: 'L5-TM',
    },
    landsat_etm_c2_l1: { patterns: [], ids: [], fallback: 'L7-ETM' },
    // Landsat 8 and 9 (`LC81830292014196LGN01`, `LC09_L1TP_...`): OLI, pan-sharpened to 15 m as ETM+.
    landsat_ot_c2_l1: {
        patterns: [],
        ids: [[/^L[CO]0?9/i, 'L9-OLI']],
        fallback: 'L8-OLI',
    },
};

const CORNERS = ['nw', 'ne', 'se', 'sw'] as const;

function sensorOf(dataset: UsgsDataset, record: Pick<SceneRecord, 'entityId' | 'metadata'>): Sensor {
    const camera = record.metadata[CAMERA_FIELD] ?? '';
    const cameras = CAMERAS[dataset];
    // Admin sweep 2026-11-14 (bug 5): an Argon frame's id wins over metadata that names another camera of `corona2`.
    if (ARGON_FRAME_ID.test(record.entityId)) {
        return 'KH-5';
    }
    const named =
        cameras.patterns.find(([pattern]) => pattern.test(camera)) ?? cameras.ids.find(([pattern]) => pattern.test(record.entityId));
    return named?.[1] ?? cameras.fallback;
}

/**
 * The camera of a stored scene: the one its id names when the record holds only its dataset's fallback. A scene harvested before
 * the id rules keeps the fallback until the next harvest (live 2026-11-13: every `corona2` scene harvested on 2026-10-25 said KH-4A,
 * and the Argon frame DS09065A073MC043, 550 km square, was imported and searched as a Corona strip).
 */
export function trueSensor(scene: Pick<UsgsSceneDoc, 'dataset' | 'entityId' | 'sensor'>): Sensor {
    const cameras = CAMERAS[scene.dataset];
    if (ARGON_FRAME_ID.test(scene.entityId)) {
        return 'KH-5';
    }
    if (scene.sensor !== cameras.fallback) {
        return scene.sensor;
    }
    return cameras.ids.find(([pattern]) => pattern.test(scene.entityId))?.[1] ?? scene.sensor;
}

/** A metadata number, or undefined when the field is missing or not a number in range. */
function coordinate(metadata: Readonly<Record<string, string>>, field: string, limit: number): number | undefined {
    const value = Number.parseFloat(metadata[field] ?? '');
    return Number.isFinite(value) && Math.abs(value) <= limit ? value : undefined;
}

/** `NW Corner Lat dec` and `NW Corner Long dec` (UNVERIFIED names) as a vertex, or undefined. */
function corner(metadata: Readonly<Record<string, string>>, name: (typeof CORNERS)[number]) {
    const prefix = `${name.toUpperCase()} Corner`;
    const lat = coordinate(metadata, `${prefix} Lat dec`, 90);
    const lng = coordinate(metadata, `${prefix} Long dec`, 180);
    return lat === undefined || lng === undefined ? undefined : { lat, lng };
}

/** The four corners when the metadata lists every one of them. */
function cornersOf(metadata: Readonly<Record<string, string>>): UsgsSceneDoc['corners'] {
    const [nw, ne, se, sw] = CORNERS.map((name) => corner(metadata, name));
    return nw === undefined || ne === undefined || se === undefined || sw === undefined ? undefined : { nw, ne, se, sw };
}

/** USGS's `-1` (none recorded) is absent; anything else is kept within 0–100. */
function cloudOf(cloudCover: number | null): number | undefined {
    return cloudCover === null || cloudCover < 0 ? undefined : Math.min(100, cloudCover);
}

/** The browse address when it is a browse image on `ims.cr.usgs.gov` or (M25) LandsatLook (never anything else: no fetch of data's addresses). */
export function browseSourceOf(record: Pick<SceneRecord, 'browseUrl'>): string | undefined {
    return record.browseUrl !== undefined && validate(usgsBrowseUrlSchema, record.browseUrl).ok ? record.browseUrl : undefined;
}

function displayIdOf(record: SceneRecord): string | undefined {
    return record.displayId === record.entityId || record.displayId === '' ? undefined : record.displayId.slice(0, 64);
}

/** The scene fields of `record` over a city of `bounds`, or undefined for a record the harvest skips (logged). */
export function sceneFields(record: SceneRecord, dataset: UsgsDataset, bounds: BoundsRecord): SceneFields | undefined {
    const footprint = footprintOf(record.footprint);
    if (!isId(record.entityId) || footprint === undefined) {
        return undefined;
    }
    const sensor = sensorOf(dataset, record);
    const corners = cornersOf(record.metadata);
    const optional = { displayId: displayIdOf(record), corners, cloudCover: cloudOf(record.cloudCover) };
    return {
        entityId: record.entityId,
        dataset,
        sensor,
        acquisitionDate: record.acquisitionDate,
        downloadAvailable: record.downloadAvailable,
        footprint,
        resolutionM: SENSOR_SPECS[sensor].resolutionM,
        coverage: footprintCoverage(footprint, bounds, { sensor, corners }),
        ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
    };
}
