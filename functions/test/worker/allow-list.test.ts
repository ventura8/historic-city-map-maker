/**
 * The allow-lists of a worker's job (`functions/src/worker/allow-list.ts`, `docs/research/M7-local-worker.md` §2.5): a
 * job's parameters name its extra documents and inputs only when they are well-formed and of its type, so a malformed
 * parameter never widens what a worker may read.
 */
import { FIRESTORE_PATHS, type JobDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { omit } from '../../src/api/objects.js';
import { documentTarget, inputVersionsOf, mayRead, mayWrite } from '../../src/worker/allow-list.js';
import { CITY, FOLDER, JOB, LAYER, localJob } from './world.js';

function scope(job: JobDoc) {
    return { cityId: CITY, jobId: JOB, job, versionId: JOB, layerId: LAYER, inputScans: [] };
}

describe('documents', () => {
    it('happyPath_aJobWithoutALayerHasNoLayerDocument', () => {
        const job = omit(localJob(), ['layerId']);

        expect(documentTarget(scope(job), FIRESTORE_PATHS.layer(CITY, LAYER))).toBeUndefined();
        expect(documentTarget(scope(job), FIRESTORE_PATHS.job(CITY, JOB))).toBe('job');
    });

    // A version of the city is still `held` (read-only, M15) for any job: never the run's `base`.
    it.each([
        [
            'an import whose scene is no id',
            localJob({ params: { entityId: '../other', dataset: 'corona2' } }),
            FIRESTORE_PATHS.usgsScenes(CITY),
            undefined,
        ],
        [
            'a re-georeference whose base is no id',
            localJob({ type: 'regeoref', params: { basedOn: 42 } }),
            FIRESTORE_PATHS.layerVersions(CITY),
            'held',
        ],
    ])('badPath_%sNamesNoExtraDocument', (_name, job, collection, readOnly) => {
        expect([`${collection}/42`, `${collection}/other`].map((path) => documentTarget(scope(job), path))).toEqual([readOnly, readOnly]);
        expect(documentTarget(scope(job), FIRESTORE_PATHS.city(CITY))).toBe('city');
    });
});

describe('the pass of an import (M9)', () => {
    const job = localJob({ params: { entityId: 'D3C1203-300415F006', dataset: 'declassiii', sensor: 'KH-9-pan' } });
    const pass = (key: string, city = CITY): string => `${FIRESTORE_PATHS.imageryPasses(city)}/${key}`;

    it('happyPath_theImportReadsItsOwnPassOnADate', () => {
        expect(documentTarget(scope(job), pass('D3C1203-300415-F-1975-08-20'))).toBe('pass');
    });

    it.each([
        ['another mission', pass('D3C1999-300415-F-1975-08-20')],
        ['another camera', pass('D3C1203-300415-A-1975-08-20')],
        ['no date', pass('D3C1203-300415-F-')],
        ['a way out of the collection', pass('D3C1203-300415-F-1975-08-20/x')],
        ['another city', pass('D3C1203-300415-F-1975-08-20', 'other-city')],
    ])('badPath_%sIsOffTheList', (_name, path) => {
        expect(documentTarget(scope(job), path)).toBeUndefined();
    });

    it('badPath_aJobThatFetchesNoSceneHasNoPass', () => {
        const regeoref = localJob({ type: 'regeoref', params: { basedOn: 'v-1' } });
        const unreadable = localJob({ params: { entityId: 'lower-case-id', dataset: 'corona2' } });

        expect(documentTarget(scope(regeoref), pass('D3C1203-300415-F-1975-08-20'))).toBeUndefined();
        expect(documentTarget(scope(unreadable), pass('lower-case-id-1975-08-20'))).toBeUndefined();
    });
});

describe('a join (M8)', () => {
    const parts = [
        { versionId: 'v-f039', layerId: 'layer-f039' },
        { versionId: 'v-f040', layerId: 'layer-f040' },
    ];
    const join = localJob({ type: 'layer-join', params: { parts, sensor: 'KH-9-pan' } });

    it('happyPath_itsFramesAreReadOnlyBases_itsScansInputs', () => {
        expect(documentTarget(scope(join), FIRESTORE_PATHS.layerVersion(CITY, 'v-f040'))).toBe('base');
        expect(mayRead(scope(join), `rasters/${CITY}/layer-f039/v-f039/scan.tif`)).toBe(true);
        expect(mayRead(scope(join), `rasters/${CITY}/layer-f040/v-f040/scan.tif`)).toBe(true);
    });

    it('happyPath_aFrameReGeoreferencedReadsTheScanOfItsBase_itsVersionNamesIt', () => {
        const base = `rasters/${CITY}/layer-f039/im-f039/scan.tif`;
        const named = { ...scope(join), inputScans: [base] };

        expect(inputVersionsOf(join)).toEqual(['v-f039', 'v-f040']);
        expect(mayRead(scope(join), base)).toBe(false);
        expect(mayRead(named, base)).toBe(true);
        expect(mayWrite(named, base)).toBe(false);
    });

    it.each([
        ['another city', 'rasters/other/layer-f039/im-f039/scan.tif'],
        ['a way out of the city', `rasters/${CITY}/../other/l/v/scan.tif`],
        ['no raster at all', `work/${CITY}/job/warped.tif`],
    ])('badPath_aScanPathOf%sIsNoInput', (_name, path) => {
        expect(mayRead({ ...scope(join), inputScans: [path] }, path)).toBe(false);
    });

    it('badPath_nothingElseOfAFrameIsReadOrWritten', () => {
        expect(mayRead(scope(join), `rasters/${CITY}/layer-f039/v-f039/cog.tif`)).toBe(false);
        expect(mayWrite(scope(join), `rasters/${CITY}/layer-f039/v-f039/scan.tif`)).toBe(false);
        expect(documentTarget(scope(join), FIRESTORE_PATHS.layerVersion(CITY, 'v-other'))).toBe('held');
    });

    it.each([
        [
            'parameters that do not parse',
            localJob({ type: 'layer-join', params: { parts: [{ versionId: '../x', layerId: 'l' }], sensor: 'KH-9-pan' } }),
        ],
        ['a job of another type', localJob({ params: { parts, sensor: 'KH-9-pan' } })],
    ])('badPath_%sNameNoFrame', (_name, job) => {
        expect(documentTarget(scope(job), FIRESTORE_PATHS.layerVersion(CITY, 'v-f039'))).toBe('held');
        expect(mayRead(scope(job), `rasters/${CITY}/layer-f039/v-f039/scan.tif`)).toBe(false);
    });
});

describe('the frames a frame is joined to (M15)', () => {
    const job = localJob();

    it('happyPath_everyVersionOfTheCityIsReadOnly_andItsFiveMetreImage @S-A62-HAPPY-HELD-FRAMES', () => {
        expect(documentTarget(scope(job), FIRESTORE_PATHS.layerVersion(CITY, 'v-1972'))).toBe('held');
        expect(documentTarget(scope(job), FIRESTORE_PATHS.layerVersion(CITY, JOB))).toBe('version');
        expect(mayRead(scope(job), `rasters/${CITY}/layer-1972/v-1972/align.tif`)).toBe(true);
    });

    it.each([
        ['another city', FIRESTORE_PATHS.layerVersion('bacau', 'v-1972')],
        ['a way out of the collection', `${FIRESTORE_PATHS.layerVersions(CITY)}/v-1972/logs`],
        ['no id', `${FIRESTORE_PATHS.layerVersions(CITY)}/../x`],
    ])('badPath_aVersionOf%sIsOffTheList', (_name, path) => {
        expect(documentTarget(scope(job), path)).toBeUndefined();
    });

    it.each([
        ['another city', 'rasters/bacau/layer-1972/v-1972/align.tif'],
        ['another file of a frame', `rasters/${CITY}/layer-1972/v-1972/scan.tif`],
        ['a way out of the city', `rasters/${CITY}/../x/v-1972/align.tif`],
        ['a deeper path', `rasters/${CITY}/layer-1972/v-1972/x/align.tif`],
    ])('badPath_theImageOf%sIsNotRead @S-A62-BAD-HELD-FRAMES-WRITE', (_name, path) => {
        expect(mayRead(scope(job), path)).toBe(false);
    });

    it('badPath_anotherFramesImageIsNeverWritten @S-A62-BAD-HELD-FRAMES-WRITE', () => {
        expect(mayWrite(scope(job), `rasters/${CITY}/layer-1972/v-1972/align.tif`)).toBe(false);
        expect(mayWrite(scope(job), `${FOLDER}/align.tif`)).toBe(true);
    });
});

describe('objects', () => {
    it('happyPath_theVersionsFilesAreWrittenAndReadAndNothingElseWritten', () => {
        const job = localJob();

        expect([mayWrite(scope(job), `${FOLDER}/cog.tif`), mayRead(scope(job), `${FOLDER}/cog.tif`)]).toEqual([true, true]);
        expect([mayWrite(scope(job), `${FOLDER}/other.bin`), mayRead(scope(job), FOLDER)]).toEqual([false, false]);
    });

    it('badPath_aGeotiffImportWhoseUploadIsNoTextReadsNoUpload', () => {
        const job = localJob({ type: 'geotiff-import', params: { uploadPath: ['uploads/x.tif'], replaces: false } });

        expect(mayRead(scope(job), 'uploads/x.tif')).toBe(false);
    });
});
