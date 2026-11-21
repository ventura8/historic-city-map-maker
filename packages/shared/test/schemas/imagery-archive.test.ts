/**
 * M20 (`docs/research/M20-import-local.md` §4, §5, §7): the local archive's contracts. The map threshold's table (no scale, 1:500,
 * 1:31000, 1:40000, the cap), the rights that publish, the credit line, the report's limits and a strict refusal of extra fields.
 */
import { describe, expect, it } from 'vitest';

import {
    ARCHIVE_MAX_SERIES,
    archiveDocSchema,
    archiveSeriesParamsSchema,
    archiveSeriesSchema,
    creditLine,
    gridDocSchema,
    helpItemSchema,
    layerRightsOf,
    layerRightsSchema,
    mapThresholdM,
    opsDailyDocSchema,
    rightsAllowPublish,
    rightsSchema,
    type ArchiveSeries,
    type Rights,
} from '../../src/schemas/imagery-archive.js';
import { timestampFromDate } from '../../src/schemas/firestore-common.js';
import { cityImagerySchema, imagerySettingsOf } from '../../src/schemas/imagery-settings.js';
import { JOB_PARAMS_SCHEMAS, JOB_STEPS, layerVersionDocSchema } from '../../src/schemas/imagery.js';
import { jobDocSchema } from '../../src/schemas/firestore-ops.js';
import { layerSchema } from '../../src/schemas/manifest.js';
import { validate } from '../../src/schemas/validation.js';
import { imageryArchiveImportRequestSchema, workerArchiveReportRequestSchema } from '../../src/api/archive.js';

const AT = timestampFromDate(new Date('2026-11-09T08:00:00Z'));

const RIGHTS: Rights = { licence: 'PD', state: 'clear', author: 'IGA', year: '1895', sourceLabel: 'Idei Urbane – DocuBucurești' };

function series(overrides: Partial<ArchiveSeries> = {}): ArchiveSeries {
    return {
        seriesId: 's-0123456789ab',
        class: 'grid',
        title: 'Planul IGA 1895',
        year: 1895,
        files: 4,
        bytes: 1000,
        action: 'import',
        encoding: 'grey',
        rights: RIGHTS,
        estimate: { maxzoom: 18, tilesBytes: 1000, minutes: 5, auto: 'likely' },
        order: 1,
        ...overrides,
    };
}

describe('mapThresholdM (§5, the owner of 2026-11-09)', () => {
    it.each([
        ['no stated scale never auto-publishes', undefined, 60, undefined],
        ['1:500 keeps the city threshold', 500, 60, 15],
        ['1:15000 is the city threshold', 15_000, 60, 15],
        ['Baedeker 1:31000 is 31 m', 31_000, 60, 31],
        ['the 1897 Hungarian 1:40000 is 40 m', 40_000, 60, 40],
        ['1:100000 stops at the 60 m cap', 100_000, 60, 60],
        ['an owner cap of 100 m lets 1:100000 reach it', 100_000, 100, 100],
    ])('happyPath_%s', (_name, scale, cap, expected) => {
        expect(mapThresholdM(15, scale, cap)).toBe(expected);
    });

    it('happyPath_theDefaultCapIs60m', () => {
        expect(mapThresholdM(15, 1_000_000)).toBe(60);
    });

    it('badPath_aCapUnderTheCityThresholdNeverLowersIt', () => {
        expect(mapThresholdM(30, 500, 15)).toBe(30);
    });
});

describe('rights (§7)', () => {
    it('happyPath_clearRightsWithALicencePublish', () => {
        expect(rightsAllowPublish(RIGHTS)).toBe(true);
    });

    it.each([
        ['waiting for confirmation', { ...RIGHTS, state: 'needs-confirmation' }],
        ['never to be published', { ...RIGHTS, state: 'do-not-publish' }],
        ['of an unknown licence', { ...RIGHTS, licence: 'unknown' }],
        ['absent', undefined],
    ] as const)('badPath_rights %s do not publish', (_name, rights) => {
        expect(rightsAllowPublish(rights)).toBe(false);
    });

    it('badPath_aPermissionNamesWhoGaveIt', () => {
        expect(validate(rightsSchema, { ...RIGHTS, licence: 'permission' }).ok).toBe(false);
        expect(validate(rightsSchema, { ...RIGHTS, licence: 'permission', confirmedBy: 'the owner', confirmedAt: AT }).ok).toBe(true);
    });

    it('happyPath_theCreditLineNamesAuthorTitleYearLicenceAndScan', () => {
        expect(creditLine({ ...RIGHTS, watermark: 'romaniaforum' }, 'Planul IGA')).toBe(
            'IGA, Planul IGA, 1895 · PD · scan: Idei Urbane – DocuBucurești (romaniaforum)',
        );
    });

    it('happyPath_aCreditLineWithoutSourceOrAuthorKeepsWhatItHas', () => {
        expect(creditLine({ licence: 'unknown', state: 'needs-confirmation', year: 'c. 1900' }, 'Plan')).toBe('Plan, c. 1900');
        expect(creditLine({ licence: 'PD', state: 'clear', year: '1911', watermark: 'dacoromanica' }, 'Plan')).toBe(
            'Plan, 1911 · PD · scan (dacoromanica)',
        );
        const library = { label: 'Biblioteca Academiei Române', url: 'https://commons.wikimedia.org/' };
        expect(creditLine({ ...RIGHTS, original: library }, 'Planul IGA')).toBe(
            'IGA, Planul IGA, 1895 · PD · scan: Idei Urbane – DocuBucurești · original: Biblioteca Academiei Române',
        );
        expect(creditLine({ licence: 'PD', state: 'clear', year: '1911', original: { label: 'UAUIM', probable: true } }, 'Plan')).toBe(
            'Plan, 1911 · PD · original, probably: UAUIM',
        );
        expect(rightsSchema.safeParse({ ...RIGHTS, original: { label: 'UAUIM', probable: false } }).success).toBe(false);
        expect(opsDailyDocSchema().safeParse({ updatedBy: 'system:imagery', updatedAt: { seconds: 1, nanoseconds: 0 } }).success).toBe(
            true,
        );
        expect(opsDailyDocSchema().safeParse({ count: 1 }).success).toBe(false);
    });

    it('badPath_theCreditLineNeverPassesTheAttributionLimit', () => {
        expect(creditLine({ ...RIGHTS, author: 'A'.repeat(200), note: 'n' }, 'T'.repeat(200)).length).toBeLessThanOrEqual(500);
    });
});

describe('the restitch flag (DECISIONS §216g)', () => {
    it('happyPath_onlyAnArchiveSeriesJobTakesTheRestitchFlag', () => {
        const params = {
            archiveId: 'ar-0123456789abcdef',
            seriesId: 's-0123456789ab',
            class: 'pieces',
            sheets: 60,
            encoding: 'lineart',
            order: 0,
            referenceLayerIds: [],
        };
        expect(validate(archiveSeriesParamsSchema, { ...params, restitch: true }).ok).toBe(true);
        expect(validate(archiveSeriesParamsSchema, { ...params, restitch: false }).ok).toBe(true);
        expect(validate(archiveSeriesParamsSchema, { ...params, unknownFlag: true }).ok).toBe(false);
        expect(validate(JOB_PARAMS_SCHEMAS.regeoref, { basedOn: 'v1', restitch: true }).ok).toBe(false);
    });
});

describe('the report and the job (§2.4, §4)', () => {
    const report = {
        name: 'harti.zip',
        source: 'zip',
        fileCount: 5703,
        bytes: 10,
        scannedAt: AT,
        workerId: 'w-0123456789abcdef',
        series: [series()],
        skipped: { 'duplicate-of': 10, 'not-a-map': 3 },
        createdBy: 'u-admin',
        updatedBy: 'u-admin',
        updatedAt: AT,
    };

    it('happyPath_aReportRoundTrips', () => {
        expect(validate(archiveDocSchema, report)).toMatchObject({ ok: true, value: report });
    });

    it('badPath_moreThan200SeriesAreRefused', () => {
        const many = Array.from({ length: ARCHIVE_MAX_SERIES + 1 }, () => series());
        expect(validate(archiveDocSchema, { ...report, series: many }).ok).toBe(false);
    });

    it('badPath_anExtraFieldIsRefused', () => {
        expect(validate(archiveDocSchema, { ...report, hostPath: '/home/owner/harti' }).ok).toBe(false);
        expect(validate(archiveSeriesSchema, { ...series(), path: '/home' }).ok).toBe(false);
    });

    it('badPath_aSkippedSeriesSaysWhy', () => {
        expect(validate(archiveSeriesSchema, series({ action: 'skip' })).ok).toBe(false);
        expect(validate(archiveSeriesSchema, series({ action: 'skip', reason: 'do-not-publish' })).ok).toBe(true);
    });

    it('happyPath_theReportRequestCarriesTheSampleOfSkippedPaths', () => {
        const { scannedAt, createdBy, updatedBy, updatedAt, ...sent } = report;
        const request = {
            ...sent,
            cityId: 'bucharest',
            archiveId: 'ar-0123456789abcdef',
            issues: [{ path: 'x/Thumbs.db', reason: 'not-a-map' }],
        };
        expect([scannedAt, createdBy, updatedBy, updatedAt]).toHaveLength(4);
        expect(validate(workerArchiveReportRequestSchema, request).ok).toBe(true);
        expect(validate(workerArchiveReportRequestSchema, { ...request, archiveId: '../x' }).ok).toBe(false);
    });

    it('badPath_anImportNamesEachSeriesOnce', () => {
        const choice = { seriesId: 's-0123456789ab', include: true };
        const request = { cityId: 'bucharest', archiveId: 'ar-0123456789abcdef', series: [choice] };
        expect(validate(imageryArchiveImportRequestSchema, request).ok).toBe(true);
        expect(validate(imageryArchiveImportRequestSchema, { ...request, series: [choice, choice] }).ok).toBe(false);
    });

    it('happyPath_anArchiveSeriesJobIsLocalOnlyAndCountsWhenReleased', () => {
        const params = {
            archiveId: 'ar-0123456789abcdef',
            seriesId: 's-0123456789ab',
            class: 'grid',
            sheets: 4545,
            encoding: 'lineart',
            order: 0,
            referenceLayerIds: [],
        };
        expect(validate(JOB_PARAMS_SCHEMAS['archive-series'], params).ok).toBe(true);
        expect(validate(archiveSeriesParamsSchema, { ...params, sheets: 0 }).ok).toBe(false);
        const job = {
            type: 'archive-series',
            status: 'queued',
            params,
            createdBy: 'u-admin',
            createdAt: AT,
            runOn: 'local',
            localOnly: true,
            waitReason: 'daily',
            updatedBy: 'u-admin',
            updatedAt: AT,
        };
        expect(validate(jobDocSchema, job).ok).toBe(true);
        expect(validate(jobDocSchema, { ...job, countedAt: AT, waitReason: 'worker' }).ok).toBe(true);
        expect(JOB_STEPS['archive-series'].slice(0, 2)).toEqual(['gather', 'place']);
    });

    it('happyPath_anArchiveVersionCarriesItsSourceRightsReportAndHelp', () => {
        const version = {
            layerId: 'planul-iga-1895',
            jobId: 'ar-1-s',
            origin: 'archive',
            state: 'processing',
            source: { kind: 'archive', archiveId: 'ar-0123456789abcdef', seriesId: 's-0123456789ab', sheetCount: 4 },
            label: { ro: 'Planul IGA 1895' },
            year: 1895,
            rights: RIGHTS,
            archive: {
                method: 'grid',
                encoding: 'grey',
                paperTransparent: false,
                checkpointCount: 20,
                checksDropped: 0,
                measuredPct: 80,
                rivalClean: true,
            },
            help: { reason: 'no-path', note: 'No automatic placement for this series yet.', at: AT },
            createdBy: 'u-admin',
            createdAt: AT,
            updatedBy: 'u-admin',
            updatedAt: AT,
        };
        expect(validate(layerVersionDocSchema, version).ok).toBe(true);
        expect(validate(helpItemSchema, { ...version.help, extra: 1 }).ok).toBe(false);
    });

    it('happyPath_aGridRoundTrips', () => {
        const grid = {
            label: 'București',
            grammar: 'bucharest',
            cellM: 500,
            originX: 2_900_000,
            originY: 5_540_000,
            scale: 1,
            rotationDeg: 0,
            updatedBy: 'u-admin',
            updatedAt: AT,
        };
        expect(validate(gridDocSchema, grid).ok).toBe(true);
        expect(validate(gridDocSchema, { ...grid, grammar: 'other' }).ok).toBe(false);
    });
});

describe('settings and the manifest (§5, §7)', () => {
    it('happyPath_aCityThatSetNothingCapsMapsAt60mAndAutoPublishesThem', () => {
        expect(imagerySettingsOf(undefined)).toMatchObject({ mapThresholdMaxM: 60, mapAutoPublish: true });
        expect(imagerySettingsOf({ mapThresholdMaxM: 100, mapAutoPublish: false })).toMatchObject({
            mapThresholdMaxM: 100,
            mapAutoPublish: false,
        });
    });

    it('badPath_theCapStaysWithin15And200', () => {
        expect(validate(cityImagerySchema, { mapThresholdMaxM: 14 }).ok).toBe(false);
        expect(validate(cityImagerySchema, { mapThresholdMaxM: 201 }).ok).toBe(false);
    });

    it('happyPath_aV1LayerWithoutRightsIsStillValid', () => {
        const layer = {
            id: 'plan',
            year: 1911,
            label: { ro: 'Plan', en: 'Plan' },
            kind: 'map',
            attribution: 'IGA',
            source: { type: 'pmtiles', url: 'https://x.example/t.pmtiles' },
            minzoom: 10,
            maxzoom: 18,
            order: 1,
            defaultVisible: false,
            opacity: 0.85,
        };
        expect(validate(layerSchema, layer).ok).toBe(true);
    });
});

describe('layerRightsOf (§7, the layer)', () => {
    it('happyPath_theLayerKeepsTheLicenceAuthorAndSource', () => {
        const rights: Rights = { ...RIGHTS, sourceUrl: 'https://ideiurbane.ro/docubucuresti-planuri-harti-si-alte-documente/' };
        expect(layerRightsOf(rights)).toEqual({
            licence: 'PD',
            author: 'IGA',
            source: { label: 'Idei Urbane – DocuBucurești', url: rights.sourceUrl },
        });
        expect(layerRightsOf({ licence: 'CC0', state: 'clear', year: '1911' })).toEqual({ licence: 'CC0' });
        expect(layerRightsOf({ licence: 'PD', state: 'clear', year: '1911', sourceLabel: 'IGA' })).toEqual({
            licence: 'PD',
            source: { label: 'IGA' },
        });
    });

    it('badPath_anUnknownLicenceShowsNothing', () => {
        expect(layerRightsOf({ licence: 'unknown', state: 'needs-confirmation', year: '1977' })).toBeUndefined();
    });

    it('badPath_theLayerRefusesRightsOfAnUnknownLicenceOrAnExtraField_andTheV1ManifestCarriesNone', () => {
        expect(validate(layerRightsSchema, { licence: 'PD', author: 'IGA' }).ok).toBe(true);
        expect(validate(layerRightsSchema, { licence: 'unknown' }).ok).toBe(false);
        expect(validate(layerRightsSchema, { licence: 'PD', note: 'x' }).ok).toBe(false);
        const layer = {
            id: 'plan',
            year: 1911,
            label: { ro: 'Plan', en: 'Plan' },
            kind: 'map',
            attribution: 'IGA',
            source: { type: 'pmtiles', url: 'https://x.example/t.pmtiles' },
            minzoom: 10,
            maxzoom: 18,
            order: 1,
            defaultVisible: false,
            opacity: 0.85,
        };
        expect(validate(layerSchema, { ...layer, rights: { licence: 'PD' } }).ok).toBe(false);
    });
});

describe('an archive version waiting for a person (the help queue)', () => {
    it('badPath_anArchiveVersionWaitingForAPersonSaysWhyInsteadOfAScan', () => {
        const waiting = {
            layerId: 'planul-iga-1895',
            jobId: 'ar-1-s',
            origin: 'archive',
            state: 'needs_gcps',
            label: { ro: 'Planul IGA 1895' },
            year: 1895,
            help: { reason: 'no-path', note: 'No automatic placement for this series yet.', at: AT },
            createdBy: 'u-admin',
            createdAt: AT,
            updatedBy: 'u-admin',
            updatedAt: AT,
        };
        expect(validate(layerVersionDocSchema, waiting).ok).toBe(true);
        expect(validate(layerVersionDocSchema, { ...waiting, help: undefined }).ok).toBe(false);
        expect(validate(layerVersionDocSchema, { ...waiting, origin: 'upload' }).ok).toBe(false);
    });
});
