/** The static export of a city (M5; docs/research/M5-interfaces.md §5): its layout, its rights rules and its record. */
import { describe, expect, it } from 'vitest';

import {
    cityExportDocSchema,
    EXPORT_FILE_NAME_PATTERN,
    EXPORT_LAYOUT,
    EXPORT_LIMITS,
    EXPORT_STATES,
    exportFileName,
    exportPhotoPath,
    exportRasterPath,
    exportTilesPath,
    OPEN_EXPORT_STATES,
    rasterExportable,
    RESTRICTED_LICENSES,
    restrictedPhotoIds,
} from '../../src/schemas/city-export.js';
import { timestampFromDate } from '../../src/schemas/firestore-common.js';
import { LICENSES } from '../../src/schemas/manifest.js';
import { validate } from '../../src/schemas/validation.js';

const AT = timestampFromDate(new Date('2026-11-02T10:00:00Z'));

describe('the export layout', () => {
    it('happyPath_photosAndScansHaveTheirFolders', () => {
        expect([exportPhotoPath('strand-1976', 'web'), exportPhotoPath('strand-1976', 'thumb'), exportRasterPath('kh4a-1966')]).toEqual([
            'photos/strand-1976/web.webp',
            'photos/strand-1976/thumb.webp',
            'rasters/kh4a-1966.tif',
        ]);
        expect(exportTilesPath('kh4a-1966')).toBe('tiles/kh4a-1966.pmtiles');
        expect(Object.values(EXPORT_LAYOUT)).toEqual([
            'index.html',
            'city.json',
            'README.md',
            'RIGHTS.md',
            'engine',
            'photos',
            'rasters',
            'tiles',
        ]);
    });

    it.each([
        ['a photo id that climbs up', () => exportPhotoPath('..', 'web')],
        ['a photo id with a slash', () => exportPhotoPath('a/b', 'thumb')],
        ['a layer id with a space', () => exportRasterPath('kh 4')],
    ])('badPath_%s_throws', (_name, build) => {
        expect(build).toThrow(RangeError);
    });

    it('happyPath_theDownloadIsNamedAfterTheCityAndTheDay', () => {
        const name = exportFileName('cluj', new Date('2026-11-02T23:59:59Z'));

        expect(name).toBe('cluj-2026-11-02.zip');
        expect(EXPORT_FILE_NAME_PATTERN.test(name)).toBe(true);
        expect(EXPORT_FILE_NAME_PATTERN.test('../cluj-2026-11-02.zip')).toBe(false);
    });

    it('happyPath_theLimitsKeepTheZipUnderZip64', () => {
        expect(EXPORT_LIMITS.maxBytes).toBeLessThan(2 ** 31);
        expect(EXPORT_LIMITS.perDayDefault).toBeLessThanOrEqual(EXPORT_LIMITS.perDayMax);
    });
});

describe('what an export may carry', () => {
    it('happyPath_onlyAUsgsFramesScanTravels', () => {
        expect(rasterExportable({ usgsEntityId: 'DS1035-1057DA023' })).toBe(true);
        expect(rasterExportable({})).toBe(false);
        expect(rasterExportable(undefined)).toBe(false);
    });

    it('happyPath_thePhotosLicensedForThisMapOnlyAreNamed', () => {
        const photos = [
            { id: 'a', license: 'CC0' },
            { id: 'b', license: 'permission-legacy' },
            { id: 'c', license: 'permission' },
            { id: 'd', license: 'PD' },
        ];

        expect(restrictedPhotoIds(photos)).toEqual(['b', 'c']);
        expect(restrictedPhotoIds([])).toEqual([]);
        expect(RESTRICTED_LICENSES.every((license) => (LICENSES as readonly string[]).includes(license))).toBe(true);
    });
});

describe('the export record', () => {
    const ready = {
        state: 'ready',
        requestedBy: 'uid-owner',
        rasters: false,
        engineVersion: '1.0.0',
        createdAt: AT,
        startedAt: AT,
        finishedAt: AT,
        expiresAt: AT,
        bytes: 31_457_280,
        sha256: 'ab12cd34'.repeat(8),
        counts: { photos: 45, restrictedPhotos: 45, layers: 5, rasters: 0, pois: 12 },
        updatedBy: 'system:export',
        updatedAt: AT,
    };

    it('happyPath_aReadyExportValidates', () => {
        expect(validate(cityExportDocSchema, ready).ok).toBe(true);
        expect(validate(cityExportDocSchema, { ...ready, state: 'failed', error: 'apiError.export.tooLarge' }).ok).toBe(true);
        // The message's parameters travel with the code (the size the export would have had, and the limit).
        expect(
            validate(cityExportDocSchema, {
                ...ready,
                state: 'failed',
                error: 'apiError.export.tooLarge',
                errorParams: { size: '2400000000', max: String(EXPORT_LIMITS.maxBytes) },
            }).ok,
        ).toBe(true);
    });

    it.each([
        ['an unknown state', { state: 'zipping' }],
        ['a zip over the limit', { bytes: EXPORT_LIMITS.maxBytes + 1 }],
        ['an error that is no code', { error: 'too big' }],
        ['an engine that is no version', { engineVersion: 'latest' }],
        ['an unknown count', { counts: { ...ready.counts, videos: 1 } }],
        ['a parameter that is no text', { errorParams: { size: 2 } }],
    ])('badPath_%s_isRefused', (_name, change) => {
        expect(validate(cityExportDocSchema, { ...ready, ...change }).ok).toBe(false);
    });

    it('happyPath_theOpenStatesAreStates', () => {
        expect(OPEN_EXPORT_STATES.every((state) => (EXPORT_STATES as readonly string[]).includes(state))).toBe(true);
    });
});
