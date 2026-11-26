import { describe, expect, it } from 'vitest';

import { FIRESTORE_PATHS } from '../../src/schemas/paths.js';
import { EXPORT_LIMITS } from '../../src/schemas/city-export.js';
import {
    isOwnTiles,
    parseRasterUploadPath,
    PRIVATE_BUCKET_LIFECYCLE,
    RASTER_PATHS,
    VERSION_FILES,
} from '../../src/schemas/imagery-paths.js';

describe('raster paths', () => {
    it('happyPath_everyBuilderSpellsItsPrefix', () => {
        expect([
            RASTER_PATHS.upload('bucharest', 'uid-1', 'up1', 'Qx7mP2rT9w.tif'),
            RASTER_PATHS.usgsRaw('corona2', 'DS1035-1057DA023', 'DS1035-1057DA023.tgz'),
            RASTER_PATHS.browse('declassii', 'DZB1212-500055L004001'),
            RASTER_PATHS.work('bucharest', 'job1', 'segments/a.tif'),
            RASTER_PATHS.version('bucharest', 'corona-1966', 'job1', 'cog.tif'),
            RASTER_PATHS.reference('bucharest', 'osm', '0f3c9a2e'),
            FIRESTORE_PATHS.layerVersions('bucharest'),
            FIRESTORE_PATHS.layerVersion('bucharest', 'job1'),
        ]).toEqual([
            'uploads/rasters/bucharest/uid-1/up1/Qx7mP2rT9w.tif',
            'usgs-raw/corona2/DS1035-1057DA023/DS1035-1057DA023.tgz',
            'usgs-browse/declassii/DZB1212-500055L004001.jpg',
            'work/bucharest/job1/segments/a.tif',
            'rasters/bucharest/corona-1966/job1/cog.tif',
            'reference/bucharest/osm/0f3c9a2e.geojson',
            'cities/bucharest/layerVersions',
            'cities/bucharest/layerVersions/job1',
        ]);
        expect(VERSION_FILES).toContain('studio.tif');
        expect(PRIVATE_BUCKET_LIFECYCLE.map((rule) => rule.prefix)).toEqual([
            'tmp/',
            'uploads/',
            'work/',
            'usgs-raw/',
            'reference/',
            'exports/',
        ]);
        // M5 (CR-M5-8): the exports go when their records say they expired.
        expect(PRIVATE_BUCKET_LIFECYCLE.find((rule) => rule.prefix === 'exports/')?.days).toBe(EXPORT_LIMITS.ttlDays);
    });

    it.each([
        ['an upload that is not a TIFF', () => RASTER_PATHS.upload('bucharest', 'uid-1', 'up1', 'plan.png')],
        ['an unknown dataset', () => RASTER_PATHS.browse('declass1', 'DS1')],
        ['a delivery that climbs out', () => RASTER_PATHS.usgsRaw('corona2', 'DS1', 'a..b.tgz')],
        ['a work file three folders deep', () => RASTER_PATHS.work('bucharest', 'job1', 'a/b/c.tif')],
        ['a capital in the city', () => RASTER_PATHS.version('Bucharest', 'l1', 'job1', 'cog.tif')],
        ['a reference key that is not hex', () => RASTER_PATHS.reference('bucharest', 's2', 'NOT-HEX')],
    ])('badPath_%s throws', (_name, build) => {
        expect(build).toThrow(RangeError);
    });

    it('happyPath_anUploadPathReadsBack', () => {
        expect(parseRasterUploadPath('uploads/rasters/bucharest/uid-1/up1/Qx7mP2rT9w.tiff')).toEqual({
            cityId: 'bucharest',
            uid: 'uid-1',
            uploadId: 'up1',
            fileName: 'Qx7mP2rT9w.tiff',
        });
    });

    it.each([
        'uploads/photos/bucharest/uid-1/up1/Qx7mP2rT9w.tif',
        'uploads/rasters/bucharest/uid-1/up1/short.tif',
        'uploads/rasters/bucharest/uid-1/up1/Qx7mP2rT9w.tif/extra',
        'uploads/rasters/bucharest/uid 1/up1/Qx7mP2rT9w.tif',
    ])('badPath_%s is not a raster upload', (path) => {
        expect(parseRasterUploadPath(path)).toBeUndefined();
    });
});

describe("a version's own tiles (M12)", () => {
    const own = { path: 'rasters/a/l/v/tiles.pmtiles', thumbPath: 'rasters/a/l/v/thumb.webp' };

    it('happyPath_theArchiveAndPictureInTheVersionsOwnFolder', () => {
        expect(isOwnTiles('a', 'l', 'v', own)).toBe(true);
    });

    it.each([
        { ...own, path: 'rasters/b/l2/v2/tiles.pmtiles' },
        { ...own, thumbPath: 'rasters/b/l2/v2/thumb.webp' },
        { ...own, path: 'rasters/a/l/v/cog.tif' },
        { ...own, path: 'rasters/a/l/v/../v2/tiles.pmtiles' },
    ])('badPath_another folder or file is not its own: %o', (tiles) => {
        expect(isOwnTiles('a', 'l', 'v', tiles)).toBe(false);
    });
});
