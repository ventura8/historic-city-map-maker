import { describe, expect, it } from 'vitest';

import { localImportFunnel } from '../../src/admin/archive/local-import-funnel.js';
import type { LocalImportPort } from '../../src/admin/archive/archive-port.js';
import { georefFunnel } from '../../src/admin/georef/georef-funnel.js';
import type { GeorefViewState } from '../../src/admin/georef/georef-port.js';
import { imageryFunnels } from '../../src/admin/imagery/imagery-funnels.js';
import type { ImageryViewState, UploadStatePort } from '../../src/admin/imagery/imagery-port.js';
import { tilesFunnel } from '../../src/admin/tiles/tiles-funnel.js';
import type { TilesViewState } from '../../src/admin/tiles/tiles-port.js';
import { workerFunnel } from '../../src/admin/worker/worker-funnel.js';
import type { WorkerViewPort } from '../../src/admin/worker/worker-port.js';

/**
 * The wizards' funnel snapshots (§200; `trackFunnel` turns them into signals): each page's state as steps, errors by code.
 * Scenarios: S-A150-HAPPY-FUNNEL-ORDER, S-A150-BAD-STEP-ERROR-CODE-NOT-TEXT.
 */
const tiles = (changes: Partial<TilesViewState>): TilesViewState =>
    ({ status: 'ready', step: 'seams', handedOff: false, refusal: null, ...changes }) as TilesViewState;

describe('tilesFunnel', () => {
    it('happyPath_theStepsBeforeTheOneOnScreenAreDoneAndTheHandOffCompletes', () => {
        expect(tilesFunnel(tiles({}))).toMatchObject({ wizard: 'tiles', step: 'seams', done: ['order'], errors: {}, complete: false });
        expect(tilesFunnel(tiles({ step: 'points', handedOff: true }))).toMatchObject({
            done: ['order', 'seams', 'preview', 'points'],
            complete: true,
        });
    });

    it('badPath_aRefusalOrAnUnreadSeriesIsAnErrorOfTheStepOnScreen', () => {
        expect(tilesFunnel(tiles({ refusal: { key: 'apiError.conflict' } }))?.errors).toEqual({ seams: 'apiError.conflict' });
        expect(tilesFunnel(tiles({ status: 'error' }))?.errors).toEqual({ seams: 'tiles.notRead' });
        expect(tilesFunnel(tiles({ status: 'loading' }))).toBeNull();
    });
});

const georef = (changes: Partial<GeorefViewState>, state = 'needs_gcps'): GeorefViewState =>
    ({
        version: { state },
        pairs: [],
        fit: { refusal: 'too-few' },
        saved: null,
        dirty: false,
        refusal: null,
        ...changes,
    }) as unknown as GeorefViewState;

describe('georefFunnel', () => {
    it('happyPath_pointsThenSaveThenTheApprovalWithThePointsCounted', () => {
        expect(georefFunnel(georef({}))).toMatchObject({ step: 'points', done: [], errors: {}, counts: { points: 0 } });
        const pairs = [{}, {}, {}, {}] as unknown as GeorefViewState['pairs'];
        expect(georefFunnel(georef({ pairs, fit: { refusal: null } as GeorefViewState['fit'] }))).toMatchObject({
            step: 'save',
            done: ['points'],
        });
        expect(georefFunnel(georef({ pairs, fit: { refusal: null } as GeorefViewState['fit'], saved: 'x' }, 'approved'))).toMatchObject({
            step: 'approve',
            done: ['points', 'save', 'approve'],
            complete: true,
        });
    });

    it('badPath_aFitThePointsCannotMakeAndARefusedSaveAreErrorsByCode', () => {
        const pairs = [{}, {}] as unknown as GeorefViewState['pairs'];
        expect(
            georefFunnel(georef({ pairs, fit: { refusal: 'degenerate' } as GeorefViewState['fit'], refusal: { key: 'apiError.conflict' } }))
                ?.errors,
        ).toEqual({
            points: 'georef.degenerate',
            save: 'apiError.conflict',
        });
        expect(georefFunnel({ ...georef({}), version: null })).toBeNull();
    });
});

const upload = (changes: Partial<UploadStatePort>): UploadStatePort => ({
    phase: 'idle',
    fileName: null,
    bytes: 0,
    year: '',
    needsYear: true,
    refusal: null,
    progress: 0,
    jobId: null,
    layerId: null,
    ...changes,
});

const imagery = (changes: Partial<ImageryViewState>): ImageryViewState =>
    ({
        tab: 'find',
        search: { phase: 'idle', error: null },
        detail: null,
        importing: null,
        importRefusal: null,
        upload: upload({}),
        ...changes,
    }) as unknown as ImageryViewState;

describe('imageryFunnels', () => {
    it('happyPath_findSearchesChoosesAndImports', () => {
        expect(imageryFunnels(imagery({}))).toMatchObject([{ wizard: 'usgs_import', step: 'search', done: [] }]);
        const chosen = imagery({
            search: { phase: 'done', error: null } as ImageryViewState['search'],
            detail: { kind: 'scene', id: 's' },
            importing: 's',
        });
        expect(imageryFunnels(chosen)).toMatchObject([{ step: 'import', done: ['search', 'choose', 'import'], complete: true }]);
    });

    it('badPath_aFailedSearchAndARefusedImportAreErrorsByKey', () => {
        const failed = imagery({
            search: { phase: 'failed', error: { key: 'apiError.usgs.unavailable' } } as unknown as ImageryViewState['search'],
            importRefusal: { id: 's', notice: { key: 'apiError.conflict' } },
        });
        expect(imageryFunnels(failed)[0]?.errors).toEqual({ search: 'apiError.usgs.unavailable', import: 'apiError.conflict' });
    });

    it('happyPath_anUploadChoosesAYearSendsAndIsChecked', () => {
        const at = (changes: Partial<UploadStatePort>) => imageryFunnels(imagery({ tab: 'upload', upload: upload(changes) }))[0];
        expect(at({})).toMatchObject({ wizard: 'upload', step: 'choose', done: [] });
        expect(at({ phase: 'ready', fileName: 'f' })).toMatchObject({ step: 'year', done: ['choose'] });
        expect(at({ phase: 'checking', fileName: 'f', year: '1966' })).toMatchObject({ step: 'check', done: ['choose', 'year', 'upload'] });
        expect(at({ phase: 'done', fileName: 'f', needsYear: false })).toMatchObject({ complete: true });
    });

    it('badPath_aRefusedFileAndAFailedUploadOrCheckAreErrorsByKey', () => {
        const at = (changes: Partial<UploadStatePort>) => imageryFunnels(imagery({ tab: 'upload', upload: upload(changes) }))[0]?.errors;
        expect(at({ phase: 'refused', refusal: { key: 'apiError.imagery.notTiff' } })).toEqual({ choose: 'apiError.imagery.notTiff' });
        expect(at({ phase: 'refused' })).toEqual({ choose: 'upload.refused' });
        expect(at({ phase: 'failed', fileName: 'f' })).toEqual({ upload: 'upload.failed' });
        expect(at({ phase: 'failed', fileName: 'f', jobId: 'j', refusal: { key: 'apiError.internal' } })).toEqual({
            check: 'apiError.internal',
        });
        expect(imageryFunnels(imagery({ tab: 'work' }))).toEqual([]);
    });
});

const worker = (changes: Partial<WorkerViewPort>): WorkerViewPort =>
    ({ status: 'ready', choice: 'local', worker: null, connected: false, refusal: null, ...changes }) as WorkerViewPort;

describe('workerFunnel', () => {
    it('happyPath_connectedThenCurrentCompletes', () => {
        expect(workerFunnel(worker({}))).toMatchObject({ step: 'connect', done: [], complete: false });
        const seen = { outdated: false } as WorkerViewPort['worker'];
        expect(workerFunnel(worker({ connected: true, worker: seen }))).toMatchObject({
            step: 'update',
            done: ['connect', 'update'],
            complete: true,
        });
    });

    it('badPath_anOutdatedWorkerAndARefusalAreErrorsAndTheCloudHasNone', () => {
        const old = { outdated: true } as WorkerViewPort['worker'];
        expect(workerFunnel(worker({ connected: true, worker: old, refusal: { key: 'apiError.conflict' } }))?.errors).toEqual({
            connect: 'apiError.conflict',
            update: 'adminWorker.outdated',
        });
        expect(workerFunnel(worker({ choice: 'cloud' }))).toBeNull();
        expect(workerFunnel(worker({ status: 'loading' }))).toBeNull();
    });
});

const local = (phase: LocalImportPort['phase'], error: string | null = null): LocalImportPort => ({
    phase,
    percent: 0,
    done: 0,
    total: 0,
    error,
});

describe('localImportFunnel', () => {
    it('happyPath_uploadThenScanThenDone', () => {
        expect(localImportFunnel(local('idle'))).toBeNull();
        expect(localImportFunnel(local('upload'))).toMatchObject({ step: 'upload', done: ['choose'] });
        expect(localImportFunnel(local('done'))).toMatchObject({ step: 'scan', done: ['choose', 'upload', 'scan'], complete: true });
    });

    it('badPath_aFailureIsItsCodeAndACancelGoesBackToTheChoice', () => {
        expect(localImportFunnel(local('failed', 'apiError.internal'))?.errors).toEqual({ upload: 'apiError.internal' });
        expect(localImportFunnel(local('failed'))?.errors).toEqual({ upload: 'failed' });
        expect(localImportFunnel(local('cancelled'))).toMatchObject({ step: 'choose', done: [] });
    });
});
