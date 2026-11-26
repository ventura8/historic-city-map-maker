/**
 * M16 (`docs/research/M16-recalibrate.md` §4, §7) in the admin's stores: Refine automatically, Approve with the owner's choice, the current
 * version read beside a recalibration and drawn at full detail from its public archive, and Snap my points (`georef/snap.ts`).
 */
import { FIRESTORE_PATHS, type Gcp } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { saveRequestOf } from '../../src/georef/save-request.js';
import { roughPointsOf, snapped } from '../../src/georef/snap.js';
import { INITIAL_GEOREF } from '../../src/georef/state.js';
import { IMAGERY_MODULE } from '../../src/imagery/imagery.js';
import { TILES_LAYER } from '../../src/imagery/imagery-map.js';
import { VersionPage, type VersionPageState } from '../../src/imagery/version.js';
import { failure, settle } from '../app/fakes.js';
import { factoryOf, host, mapboxHandle } from './maps.js';
import { answer, at, callsOf, CITY, cityDoc, imageryWorld, JOBS, jobDoc, setupStatus, VERSIONS, versionDoc } from './world.js';

const CURRENT = 'job-1966-0712';
const NEW = 'rg-1966-x';
const PUBLIC = 'https://storage.googleapis.com/hcm-public/tiles/bucharest/kh-4a-corona-1966/job-1966-0712.pmtiles';
const OWN = {
    path: 'tiles/bucharest/kh-4a-corona-1966/job-1966-0712.pmtiles',
    url: PUBLIC,
    bytes: 175_000_000,
    publishedAt: at('2026-10-19T08:00:00Z'),
};
const RECALIBRATED = { route: 'auto', before: { rmseM: 17.6, checks: 21 }, after: { rmseM: 14.1, checks: 21 } };

function page() {
    const world = imageryWorld();
    let state: VersionPageState | null = null;
    const version = new VersionPage(world.services, world.files, (next) => {
        state = next;
    });
    return { ...world, version, state: () => state };
}

describe('the version page: recalibrating', () => {
    it('happyPath_refineStartsANewVersionAndApproveCarriesTheOwnersChoice @S-A89-HAPPY-REFINE', async () => {
        const { version, store, callables, notices } = page();
        store.docs.set(VERSIONS(CURRENT), versionDoc());
        answer(callables, 'imagery.recalibrate', () => ({ jobId: NEW, versionId: NEW }));
        answer(callables, 'imagery.approve', () => ({ state: 'approved', jobId: CURRENT }));
        version.show(CURRENT);

        await expect(version.recalibrate()).resolves.toBe(NEW);
        await version.approve(true);

        expect(callsOf(callables, 'imagery.recalibrate')).toEqual([{ cityId: CITY, versionId: CURRENT, route: 'auto' }]);
        expect(callsOf(callables, 'imagery.approve')).toEqual([{ cityId: CITY, versionId: CURRENT, acceptWorse: true }]);
        expect(notices.map((notice) => notice.key)).toEqual([
            'adminContent.imagery.recalibrate.started',
            'adminContent.imagery.notice.approved',
        ]);
    });

    it('badPath_aRefusedRefineStaysOnTheCard @S-A89-BAD-BUSY', async () => {
        const { version, store, callables, state } = page();
        store.docs.set(VERSIONS(CURRENT), versionDoc());
        callables.answer('imagery.recalibrate' as never, () => Promise.reject(failure('failed-precondition', 'apiError.layers.busy')));
        version.show(CURRENT);

        await expect(version.recalibrate()).resolves.toBeNull();
        expect(state()?.refusal).toEqual({ key: 'apiError.layers.busy' });
    });

    it('happyPath_aRecalibrationReadsTheCurrentVersionBesideItAndTheMapSwapsBetweenThem', async () => {
        const { version, store, state } = page();
        store.docs.set(VERSIONS(CURRENT), versionDoc({ state: 'published', own: OWN }));
        store.docs.set(VERSIONS(NEW), versionDoc({ jobId: NEW, origin: 'regeoref', basedOn: CURRENT, recalibration: RECALIBRATED }));
        version.show(NEW);
        await settle();

        expect(state()?.current).toMatchObject({ id: CURRENT, state: 'published', publicUrl: PUBLIC });
        expect(state()?.version.doc?.data.recalibration).toEqual(RECALIBRATED);
        version.toggleCurrent();
        expect(state()?.showing).toBe('current');
        version.toggleCurrent();
        expect(state()?.showing).toBe('new');
    });

    // The merge of M16 with M18 item 5: deleting a recalibration says the published version stays; of a waiting one, as any image.
    it.each([
        ['published', 'adminContent.imagery.notice.rejectedRecalibration'],
        ['cancelled', 'adminContent.imagery.notice.rejected'],
    ] as const)(
        'happyPath_deleteOfARecalibrationOn_%s @S-A89-HAPPY-DELETE-NEW-FIT @S-A89-BAD-DELETE-WAITING-BASE',
        async (base, notice) => {
            const { version, store, callables, notices } = page();
            store.docs.set(VERSIONS(CURRENT), versionDoc(base === 'published' ? { state: base, own: OWN } : { state: base }));
            store.docs.set(VERSIONS(NEW), versionDoc({ jobId: NEW, origin: 'regeoref', basedOn: CURRENT, recalibration: RECALIBRATED }));
            answer(callables, 'imagery.reject', () => ({ state: 'rejected' }));
            version.show(NEW);
            await settle();

            await expect(version.reject()).resolves.toBe(true);

            expect(callsOf(callables, 'imagery.reject')).toEqual([{ cityId: CITY, versionId: NEW }]);
            expect(notices.map((shown) => shown.key)).toEqual([notice]);
        },
    );

    it('badPath_deleteBeforeAnyVersionIsShownCallsNothing', async () => {
        const { version, callables } = page();

        await expect(version.reject()).resolves.toBe(false);

        expect(callsOf(callables, 'imagery.reject')).toEqual([]);
    });

    it('badPath_anyOtherVersionHasNoCurrentToSwapTo', () => {
        const { version, store, state } = page();
        store.docs.set(VERSIONS(CURRENT), versionDoc({ basedOn: 'job-older' }));
        version.show(CURRENT);

        version.toggleCurrent();

        expect([state()?.current, state()?.showing]).toEqual([null, 'new']);
        expect(store.listeners()).toBe(4);
    });
});

describe('the map of a recalibration @S-A89-HAPPY-APPROVE-BETTER', () => {
    async function opened() {
        const { handle, native } = await mapboxHandle(null);
        const world = imageryWorld({ maps: factoryOf([{ ok: true, map: handle }]) });
        world.store.docs.set(FIRESTORE_PATHS.setupStatus, setupStatus('ok'));
        world.store.docs.set(FIRESTORE_PATHS.city(CITY), cityDoc());
        const tiles = { path: 'rasters/x/tiles.pmtiles', bytes: 1, count: 1, sha256: 'a'.repeat(64), thumbPath: 'rasters/x/thumb.webp' };
        const output = { ...(versionDoc()['output'] as Record<string, unknown>), tiles };
        world.store.docs.set(VERSIONS(CURRENT), versionDoc({ state: 'published', own: OWN, output }));
        world.store.docs.set(VERSIONS(NEW), versionDoc({ jobId: NEW, basedOn: CURRENT, recalibration: RECALIBRATED, output }));
        world.store.docs.set(JOBS(NEW), jobDoc({ status: 'awaiting_approval', waitReason: 'approval' }));
        answer(world.callables, 'imagery.previewUrl', () => ({
            url: 'https://storage.example.org/new.pmtiles',
            expiresAt: '2026-10-20T10:00:00.000Z',
            bytes: 1,
        }));
        const imagery = IMAGERY_MODULE.create(world.services);
        imagery.open(['version', NEW]);
        imagery.intents.attachMap(host());
        await settle();
        return { world, imagery, native };
    }

    it('happyPath_theCurrentOneIsDrawnFromItsPublicArchiveWithNoSignedAddress', async () => {
        const { world, imagery, native } = await opened();
        const before = callsOf(world.callables, 'imagery.previewUrl').length;

        imagery.intents.toggleCurrent();
        await settle();

        expect(before).toBe(1);
        expect(callsOf(world.callables, 'imagery.previewUrl')).toHaveLength(1);
        expect(imagery.state.image).toEqual({ status: 'ready' });
        expect(native.sources.has(`hcm-source-${TILES_LAYER}`)).toBe(true);
    });
});

describe('Snap my points', () => {
    const pair = (id: string, origin: Gcp['origin'] = 'manual', enabled = true): Gcp => ({
        ...{ id, pixel: { x: 10, y: 20 }, geo: { lat: 44.4, lng: 26.1 } },
        ...{ enabled, origin },
    });

    it('happyPath_theNewManualPointsAreTheRoughPoints @S-A89-HAPPY-POINTS', async () => {
        const world = imageryWorld();
        answer(world.callables, 'imagery.recalibrate', () => ({ jobId: NEW, versionId: NEW }));
        const points = roughPointsOf(
            [pair('a1', 'auto'), pair('g1'), pair('g2'), pair('g3', 'manual', false)],
            [pair('a1', 'auto'), pair('g1')],
        );

        const outcome = await snapped(world.services, { id: CURRENT }, points);

        expect(points).toEqual([{ pixel: { x: 10, y: 20 }, geo: { lat: 44.4, lng: 26.1 } }]);
        expect(outcome).toEqual({ saved: NEW, refusal: null });
        expect(callsOf(world.callables, 'imagery.recalibrate')).toEqual([{ cityId: CITY, versionId: CURRENT, route: 'points', points }]);
    });

    it('badPath_noNewPointsOrTooManyAreRefusedInWords @S-A89-BAD-POINTS-REFUSED', async () => {
        const world = imageryWorld();
        callables(world);
        const many = Array.from({ length: 13 }, (_, index) => pair(`g${String(index)}`));

        expect(roughPointsOf([pair('a1', 'auto')], [pair('a1', 'auto')])).toBeNull();
        expect(roughPointsOf(many, [])).toBeNull();
        await expect(snapped(world.services, null, null)).resolves.toEqual({
            saved: null,
            refusal: { key: 'adminContent.georef.snapNone' },
        });
        await expect(snapped(world.services, { id: CURRENT }, [{ pixel: { x: 1, y: 1 }, geo: { lat: 44.4, lng: 26.1 } }])).resolves.toEqual(
            {
                saved: null,
                refusal: { key: 'apiError.imagery.gcpOutside' },
            },
        );
        expect(saveRequestOf(CITY, INITIAL_GEOREF)).toBeNull();
    });

    function callables(world: ReturnType<typeof imageryWorld>): void {
        world.callables.answer('imagery.recalibrate' as never, () =>
            Promise.reject(failure('invalid-argument', 'apiError.imagery.gcpOutside')),
        );
    }
});
