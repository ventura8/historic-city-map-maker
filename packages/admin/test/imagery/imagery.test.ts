import { FIRESTORE_PATHS } from '@hcm/shared';
import { FakeMap } from '@hcm/test-support/fake-map';
import { describe, expect, it } from 'vitest';

import { detailOf, IMAGERY_MODULE, replaceOf } from '../../src/imagery/imagery.js';
import { createMapPreview } from '../../src/map/preview.js';
import { failure, settle } from '../app/fakes.js';
import { fakeFrames } from '../map/support.js';
import { factoryOf, host, mapboxHandle } from './maps.js';
import {
    answer,
    at,
    CITY,
    callsOf,
    cityDoc,
    type FakeFiles,
    imageryWorld,
    JOBS,
    jobDoc,
    SCENES,
    sceneDoc,
    setupStatus,
    VERSIONS,
    versionDoc,
} from './world.js';

/** Counts what is read of each path, while the fake answers as before. */
function countingReads(files: FakeFiles): { of(path: string): number } {
    const seen = new Map<string, number>();
    const read = files.read.bind(files);
    files.read = (path) => {
        seen.set(path, (seen.get(path) ?? 0) + 1);
        return read(path);
    };
    return { of: (path) => seen.get(path) ?? 0 };
}

const VERSION = 'job-1966-0712';
const PREVIEW = 'rasters/bucharest/kh-4a-corona-1966/job-1966-0712/preview.png';

function seeded(overrides: Parameters<typeof imageryWorld>[0] = {}) {
    const world = imageryWorld(overrides);
    world.clock.current = Date.parse('2026-10-20T09:00:00Z');
    world.store.docs.set(FIRESTORE_PATHS.setupStatus, setupStatus('ok'));
    world.store.docs.set(FIRESTORE_PATHS.city(CITY), cityDoc());
    world.store.docs.set(
        SCENES('a'),
        sceneDoc('a', { harvestedAt: at('2026-10-15T00:00:00Z'), browse: { state: 'copied', path: 'usgs-browse/corona2/a.jpg' } }),
    );
    world.store.docs.set(SCENES('b'), sceneDoc('b', { downloadAvailable: false }));
    world.store.docs.set(VERSIONS(VERSION), versionDoc());
    world.store.docs.set(JOBS(VERSION), jobDoc({ status: 'awaiting_approval', waitReason: 'approval' }));
    world.files.put('usgs-browse/corona2/a.jpg');
    return world;
}

describe('the Imagery area', () => {
    it('happyPath_theRankedFreeScenesTheWorkAndNoSearchForAFreshHarvest', async () => {
        const { services, callables } = seeded();
        const imagery = IMAGERY_MODULE.create(services);

        imagery.open([]);
        await settle();

        expect(imagery.state.usgs).toBe('ok');
        expect(imagery.state.visible.map((scene) => scene.id)).toEqual(['a']);
        expect(imagery.state.browse['a']).toEqual({ status: 'ready', url: 'blob:usgs-browse/corona2/a.jpg' });
        expect(imagery.state.versions.items.map((version) => version.id)).toEqual([VERSION]);
        expect(imagery.state.jobs[VERSION]?.waitReason).toBe('approval');
        expect(callsOf(callables, 'imagery.search')).toEqual([]);
        expect([IMAGERY_MODULE.area, imagery.hasUnsavedChanges()]).toEqual(['imagery', false]);
    });

    it('happyPath_theFiltersAndTheTabsAndAStaleHarvestSearchesByItself', async () => {
        const world = seeded();
        world.store.docs.set(SCENES('a'), sceneDoc('a', { harvestedAt: at('2026-08-01T00:00:00Z') }));
        world.store.docs.delete(SCENES('b'));
        world.store.docs.set(SCENES('b'), sceneDoc('b', { downloadAvailable: false, harvestedAt: at('2026-08-01T00:00:00Z') }));
        answer(world.callables, 'imagery.search', () => ({
            found: 2,
            added: 0,
            updated: 2,
            failedDatasets: [],
            searchedAt: '2026-10-20T09:00:00.000Z',
        }));
        const imagery = IMAGERY_MODULE.create(world.services);
        imagery.open([]);
        await settle();

        imagery.intents.setFilters({ freeOnly: false });
        const all = imagery.state.visible.map((scene) => scene.id);
        imagery.intents.setFilters({ datasets: ['declassii'] });
        imagery.intents.setTab('work');
        imagery.intents.more();
        const heard: string[] = [];
        const stop = imagery.subscribe((state) => heard.push(state.search.phase));
        await imagery.intents.search();
        stop();

        expect(callsOf(world.callables, 'imagery.search')).toHaveLength(2);
        expect(imagery.state.search.phase).toBe('done');
        expect(all).toEqual(['a', 'b']);
        expect([imagery.state.visible, imagery.state.tab]).toEqual([[], 'work']);
        // The phases in turn (the list's browse copies, asked meanwhile, change the state too).
        expect(heard.filter((phase, index) => phase !== heard[index - 1])).toEqual(['searching', 'done']);
    });

    it('badPath_withoutTheBucketsFilesNoImageShowsAndNothingIsSaved', async () => {
        const world = seeded({ files: null });
        const imagery = IMAGERY_MODULE.create(world.services);
        imagery.open(['scene', 'a']);
        await settle();

        imagery.open(['version', VERSION]);
        await settle();

        expect(imagery.state.browse['a']).toEqual({ status: 'failed', error: { key: 'apiError.imagery.browseUnavailable' } });
        expect(await imagery.intents.download()).toBe(false);
        imagery.close();
    });

    it('happyPath_aSceneOpensWithItsBrowseImageAndImportGivesItsVersion', async () => {
        const { services, callables, notices } = seeded();
        answer(callables, 'imagery.import', () => ({ jobId: 'j1', versionId: 'j1', layerId: 'kh-4a-1966' }));
        const imagery = IMAGERY_MODULE.create(services);
        imagery.open(['scene', 'a']);
        await settle();

        const versionId = await imagery.intents.importScene('a');

        expect(imagery.state.detail).toEqual({ kind: 'scene', id: 'a' });
        expect(versionId).toBe('j1');
        expect(callsOf(callables, 'imagery.import')).toEqual([{ cityId: 'bucharest', entityId: 'a' }]);
        expect(notices).toEqual([{ key: 'adminContent.imagery.notice.imported' }]);
        expect(imagery.state.importing).toBeNull();
    });

    it('badPath_aRefusedImportSaysWhyOnTheSceneAndASecondClickWaits', async () => {
        const { services, callables } = seeded();
        let refuse: () => void = () => undefined;
        callables.answer(
            'imagery.import' as never,
            (() =>
                new Promise((_resolve, reject) => {
                    refuse = () => {
                        reject(failure('failed-precondition', 'apiError.usgs.accessPending'));
                    };
                })) as never,
        );
        const imagery = IMAGERY_MODULE.create(services);
        imagery.open(['scene', 'a']);

        const first = imagery.intents.importScene('a');
        const second = await imagery.intents.importScene('a');
        refuse();

        expect([await first, second]).toEqual([null, null]);
        expect(imagery.state.importRefusal).toEqual({ id: 'a', notice: { key: 'apiError.usgs.accessPending' } });
    });
});

describe('the Imagery area: versions, the map and uploads', () => {
    it('happyPath_aVersionsPageAndItsActionsGoThroughTheVersionPage', async () => {
        const { services, callables } = seeded();
        answer(callables, 'imagery.approve', () => ({ state: 'approved', jobId: VERSION }));
        answer(callables, 'imagery.reject', () => ({ state: 'rejected' }));
        answer(callables, 'imagery.choose', () => ({ state: 'awaiting_approval' }));
        answer(callables, 'imagery.studioDone', () => ({ tilesetId: 't', layerId: 'l' }));
        answer(callables, 'imagery.retry', () => ({ status: 'queued', attempt: 1 }));
        const imagery = IMAGERY_MODULE.create(services);
        imagery.open(['version', VERSION]);

        const results = [
            await imagery.intents.approve(),
            await imagery.intents.reject(),
            await imagery.intents.choose('defer'),
            await imagery.intents.studioDone(),
            await imagery.intents.retryJob(),
            await imagery.intents.download(),
            await imagery.intents.cancelJob(),
        ];

        expect(imagery.state.version?.version.doc?.data.id).toBe(VERSION);
        expect(results).toEqual([true, true, true, true, true, false, true]);
        imagery.open([]);
        expect(imagery.state.version).toBeNull();
    });

    it('happyPath_theMapShowsTheBrowseImageAndAVersionsPreviewAtItsOpacity', async () => {
        const { handle, native } = await mapboxHandle();
        const world = seeded({ maps: factoryOf([{ ok: true, map: handle }]) });
        world.files.put(PREVIEW);
        const imagery = IMAGERY_MODULE.create(world.services);
        imagery.open(['scene', 'a']);
        imagery.intents.attachMap(host());
        await settle();
        const browse = native.sources.has('hcm-picture-browse');

        imagery.open(['version', VERSION]);
        await settle();
        imagery.intents.setPreviewOpacity(40);
        imagery.intents.zoomBy(1);

        expect([browse, native.sources.has('hcm-picture-preview')]).toEqual([true, true]);
        expect(imagery.state.previewOpacity).toBeCloseTo(0.4, 9);
        expect(native.paint.get('hcm-picture-layer-preview')?.['raster-opacity']).toBeCloseTo(0.4, 9);
        expect(imagery.state.map).toBe('ready');
    });

    it('happyPath_theBrowseCopyCanBeTriedAgain', async () => {
        const map = new FakeMap();
        const handle = {
            port: map,
            preview: createMapPreview(map, fakeFrames()),
            draw: () => Promise.reject(new Error('none')),
            destroy: () => undefined,
        };
        const world = seeded({ maps: factoryOf([{ ok: true, map: handle }]) });
        const imagery = IMAGERY_MODULE.create(world.services);
        imagery.open([]);
        imagery.intents.attachMap(host());
        await settle();

        imagery.intents.retryBrowse('a');
        imagery.intents.retryBrowse('nothing');
        await settle();

        expect(imagery.state.browse['a']?.status).toBe('ready');
    });

    it('happyPath_tryAgainOnTheBrowseImageReachesASceneFromTheRoutedRead @S-A11-HAPPY-BROWSE-RETRY-ROUTED', async () => {
        const world = seeded();
        // `b` is not free: Free only hides it, so only the routed read has it.
        answer(world.callables, 'imagery.browse', () => Promise.reject(new Error('offline')));
        const imagery = IMAGERY_MODULE.create(world.services);
        imagery.open(['scene', 'b']);
        await settle();
        expect(imagery.state.visible.map((scene) => scene.id)).toEqual(['a']);
        expect(imagery.state.browse['b']?.status).toBe('failed');
        world.files.put('usgs-browse/corona2/b.jpg');
        answer(world.callables, 'imagery.browse', () => Promise.resolve({ path: 'usgs-browse/corona2/b.jpg', contentType: 'image/jpeg' }));

        imagery.intents.retryBrowse('b');
        await settle();

        expect(imagery.state.browse['b']).toMatchObject({ status: 'ready', url: 'blob:usgs-browse/corona2/b.jpg' });
        imagery.close();
    });

    it('happyPath_theUploadIntentsReachTheUploader', async () => {
        const { services, uploads } = seeded();
        const imagery = IMAGERY_MODULE.create(services);
        imagery.open([]);
        const blob = new Blob([new Uint8Array([0x49, 0x49, 0x2a, 0])]);

        await imagery.intents.chooseFile({ name: 'scan.tif', size: blob.size, slice: (start, end) => blob.slice(start, end) });
        imagery.intents.setYear('1966');
        const before = imagery.busy?.();
        imagery.intents.startUpload();
        // Review of M18 item 1: an upload being sent holds the self-reload back, though it is no unsaved edit.
        expect([before, imagery.busy?.(), imagery.hasUnsavedChanges()]).toEqual([false, true, false]);
        imagery.intents.cancelUpload();
        await settle();
        imagery.intents.resetUpload();

        expect(uploads.started).toHaveLength(1);
        expect([imagery.state.upload.phase, imagery.busy?.()]).toEqual(['idle', false]);
    });

    it('happyPath_replaceImageOpensTheUploadForItsLayerAndTheAreaAloneForgetsIt', async () => {
        const { services, uploads } = seeded();
        const imagery = IMAGERY_MODULE.create(services);
        imagery.open(['replace', 'kh-4a-1966']);
        const opened = [imagery.state.tab, imagery.state.replaceLayer];
        const blob = new Blob([new Uint8Array([0x49, 0x49, 0x2a, 0])]);

        await imagery.intents.chooseFile({ name: 'plan-1911.tif', size: blob.size, slice: (start, end) => blob.slice(start, end) });
        imagery.open(['replace', 'not an id']);

        expect(opened).toEqual(['upload', 'kh-4a-1966']);
        expect(uploads.last.request.customMetadata).toMatchObject({ layerId: 'kh-4a-1966', year: '1911' });
        expect(imagery.state.replaceLayer).toBeNull();
        expect(replaceOf(['scene', 'kh-4a-1966'])).toBeNull();
    });

    it('happyPath_closingDetachesEverythingAndRetryAttachesAgain', async () => {
        const { services, store } = seeded();
        const imagery = IMAGERY_MODULE.create(services);
        imagery.open(['version', VERSION]);
        await settle();
        store.fail(FIRESTORE_PATHS.usgsScenes(CITY), { kind: 'failed', code: 'internal' });

        imagery.intents.retry();
        const attached = store.listeners();
        imagery.close();
        const afterClose = store.listeners();
        imagery.destroy();

        expect(attached).toBeGreaterThan(0);
        expect(afterClose).toBe(0);
        expect(imagery.state.detail).toBeNull();
    });
});

describe('the routed item', () => {
    it('happyPath_aSceneOrAVersionByIdAndAnythingElseIsNone', () => {
        expect(detailOf(['scene', 'DS1035-1057DA023'])).toEqual({ kind: 'scene', id: 'DS1035-1057DA023' });
        expect(detailOf(['version', 'abc'])).toEqual({ kind: 'version', id: 'abc' });
        expect([detailOf([]), detailOf(['layer', 'abc']), detailOf(['scene']), detailOf(['scene', 'a.b'])]).toEqual([
            null,
            null,
            null,
            null,
        ]);
    });
});

describe('Locate again on the version page', () => {
    it('happyPath_theIntentAsksTheServerForTheOpenVersion', async () => {
        const { services, callables } = seeded();
        answer(callables, 'imagery.locateAgain', () => ({ status: 'queued', attempt: 1 }));
        const imagery = IMAGERY_MODULE.create(services);
        imagery.open(['version', VERSION]);

        await expect(imagery.intents.locateAgain()).resolves.toBe(true);

        expect(callsOf(callables, 'imagery.locateAgain')).toEqual([{ cityId: 'bucharest', versionId: VERSION }]);
        imagery.close();
    });
});

describe('the browse image on the map', () => {
    it('badPath_listWritesDuringAnOpenDoNotReadTheFullSizeImageAgain @S-A11-HAPPY-HUGE-THUMBNAIL', async () => {
        const { handle } = await mapboxHandle();
        const world = seeded({ maps: factoryOf([{ ok: true, map: handle }]) });
        const reads = countingReads(world.files);
        const imagery = IMAGERY_MODULE.create(world.services);

        world.files.hold = true;
        imagery.open(['scene', 'a']);
        imagery.intents.attachMap(host());
        await settle();
        for (const entity of ['c', 'd', 'e']) {
            world.store.put(SCENES(entity), sceneDoc(entity, { browse: { state: 'copied', path: `usgs-browse/corona2/${entity}.jpg` } }));
            await settle();
        }
        const whileHeld = reads.of('usgs-browse/corona2/a.jpg');
        world.files.hold = false;
        world.files.flush();
        await settle();

        // The row's thumbnail, the page's preview and the map's one decode, however many writes came meanwhile.
        expect(whileHeld).toBeLessThanOrEqual(3);
        expect(reads.of('usgs-browse/corona2/a.jpg')).toBe(3);
        expect(world.services.pictures).toMatchObject({ decoded: [2048] });
        imagery.close();
    });
});

// M28: the Sources step's "bring it into the app" links `#/imagery/upload`.
describe('the upload address', () => {
    it('happyPath_theUploadAddressOpensTheUploadTabWithNoLayer', () => {
        const { services } = seeded();
        const imagery = IMAGERY_MODULE.create(services);
        imagery.open(['upload']);

        expect([imagery.state.tab, imagery.state.replaceLayer]).toEqual(['upload', null]);
    });
});
