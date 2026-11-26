import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { ImageryFeeds, scenesQuery, type FeedsPatch } from '../../src/imagery/feeds.js';
import { at, CITY, cityDoc, imageryWorld, JOBS, jobDoc, SCENES, sceneDoc, setupStatus, VERSIONS, versionDoc } from './world.js';

function feeds() {
    const world = imageryWorld();
    const patches: FeedsPatch[] = [];
    const reads = new ImageryFeeds(world.services, (patch) => patches.push(patch));
    const last = <K extends keyof FeedsPatch>(key: K): FeedsPatch[K] | undefined => patches.filter((patch) => key in patch).at(-1)?.[key];
    return { ...world, reads, patches, last };
}

describe('the Imagery area reads', () => {
    it('happyPath_usgsTheCitysSettingsAndFrameTheNewestHarvestScenesVersionsAndJobs', () => {
        const { reads, store, last } = feeds();
        store.docs.set(FIRESTORE_PATHS.setupStatus, setupStatus('pending'));
        store.docs.set(FIRESTORE_PATHS.city(CITY), cityDoc({ imagery: { rmseThresholdM: 9, targetYears: [1966] } }));
        store.docs.set(SCENES('a'), sceneDoc('a', { harvestedAt: at('2026-10-01T00:00:00Z') }));
        store.docs.set(SCENES('b'), sceneDoc('b', { downloadAvailable: false, harvestedAt: at('2026-10-02T00:00:00Z') }));
        store.docs.set(VERSIONS('job-1966-0712'), versionDoc());
        store.docs.set(VERSIONS('old'), versionDoc({ state: 'rejected' }));
        store.docs.set(JOBS('job-1966-0712'), jobDoc({ status: 'awaiting_approval' }));
        store.docs.set(JOBS('done'), jobDoc({ status: 'succeeded' }));

        reads.start(true);

        expect(last('usgs')).toBe('pending');
        expect(last('settings')).toEqual({
            autoPublish: true,
            rmseThresholdM: 9,
            targetYears: [1966],
            publishThroughMapbox: false,
            mapThresholdMaxM: 60,
            mapAutoPublish: true,
            landsatAuto: true,
            landsatFrom: 1984,
            landsatTo: undefined,
        });
        expect(last('frame')?.bounds).toEqual([
            [25.9, 44.3],
            [26.3, 44.6],
        ]);
        // The city has no theme here: the footprints keep their fixed colours (finding 51).
        expect(last('colors')).toEqual({ outline: '#3949ab', selected: '#c2185b' });
        expect(last('newest')).toBe('2026-10-02T00:00:00.000Z');
        expect(last('scenes')?.items.map((scene) => scene.id)).toEqual(['a']);
        expect(last('versions')?.items.map((version) => version.id)).toEqual(['job-1966-0712']);
        expect(Object.keys(last('jobs') ?? {})).toEqual(['job-1966-0712']);
        reads.showScenes(false);
        expect(
            last('scenes')
                ?.items.map((scene) => scene.id)
                .toSorted(),
        ).toEqual(['a', 'b']);
        expect(reads.active).toBe(true);
    });

    it('badPath_noSetupStatusIsUsgsMissingAndNoSceneIsNoHarvest', () => {
        const { reads, last, patches } = feeds();

        reads.start(true);

        expect([last('usgs'), last('newest'), patches.some((patch) => 'settings' in patch)]).toEqual(['missing', null, false]);
    });

    // Finding of 2026-11-12: an install record stored with Firestore timestamps failed the whole setup/status, so Find said
    // "Connect USGS" while Setup showed USGS done; one malformed area now reads as absent and USGS still answers.
    it('happyPath_aMalformedAreaOfSetupStatusLeavesUsgsConnected @S-A11-HAPPY-USGS-BESIDE-BAD-AREA', () => {
        const { reads, store, last } = feeds();
        const checkedAt = at('2026-11-12T05:45:23Z');
        store.docs.set(FIRESTORE_PATHS.setupStatus, {
            ...setupStatus('ok'),
            install: { server: { state: 'installed', release: '1.0.0+3897359', checkedAt } },
        });

        reads.start(true);

        expect(last('usgs')).toBe('ok');
    });

    it('badPath_aMalformedUsgsRecordIsUsgsMissing @S-A11-BAD-USGS-RECORD-MALFORMED', () => {
        const { reads, store, last } = feeds();
        store.docs.set(FIRESTORE_PATHS.setupStatus, { ...setupStatus('ok'), usgs: { state: 'ok', checkedAt: 'yesterday' } });

        reads.start(true);

        expect(last('usgs')).toBe('missing');
    });

    // Finding of 2026-11-12: a version stored with a scan over MAX_SCAN_PIXELS is still listed, so the owner can end it.
    it('happyPath_aVersionALaterSchemaRefusesIsStillListed @S-A12-HAPPY-LEGACY-VERSION-ENDS', () => {
        const { reads, store, last } = feeds();
        const scan = {
            path: 'rasters/bucharest/l/v/scan.tif',
            width: 258_271,
            height: 1468,
            sha256: 'a'.repeat(64),
            previewPath: 'rasters/bucharest/l/v/scan-preview.jpg',
            previewScale: 0.015,
        };
        store.docs.set(VERSIONS('legacy'), versionDoc({ state: 'needs_gcps', scan, output: undefined }));
        store.docs.set(VERSIONS('broken'), versionDoc({ layerId: 'Not An Id!' }));

        reads.start(true);

        expect(last('versions')?.items.map((version) => version.id)).toEqual(['legacy']);
    });

    it.each([
        ['download', 'ok'],
        ['search', 'pending'],
        [undefined, 'unavailable'],
    ] as const)('happyPath_aCheckThatFoundUsgsDownKeepsWhatItsRoleAllows_%s', (role, usgs) => {
        const { reads, store, last } = feeds();
        store.docs.set(FIRESTORE_PATHS.setupStatus, {
            usgs: { state: 'unavailable', detail: 'apiError.usgs.maintenance', ...(role === undefined ? {} : { role }) },
            updatedBy: 'system:ops',
            updatedAt: at('2026-10-20T00:00:00Z'),
        });

        reads.start(true);

        expect(last('usgs')).toBe(usgs);
        expect(last('guard')).toEqual({ paused: false, costAmount: null, budgetAmount: null, currency: null });
    });

    it('happyPath_moreRetryAndStop', () => {
        const { reads, store } = feeds();
        reads.start(false);
        store.fail(FIRESTORE_PATHS.usgsScenes(CITY), { kind: 'failed', code: 'internal' });

        reads.moreScenes();
        reads.retry();
        const attached = store.listeners();
        reads.stop();

        expect(attached).toBeGreaterThan(0);
        expect([store.listeners(), reads.active]).toEqual([0, false]);
        expect(scenesQuery(true)).toEqual({ where: [['downloadAvailable', '==', true]], orderBy: [['rank.score', 'desc']] });
    });
});

describe('a refused read', () => {
    it('badPath_aDeniedListenerMakesTheShellAskWhoThisIs', () => {
        const { reads, store, denials } = feeds();
        reads.start(true);

        store.fail(FIRESTORE_PATHS.setupStatus, { kind: 'denied', code: 'permission-denied' });
        store.fail(FIRESTORE_PATHS.usgsScenes(CITY), { kind: 'denied', code: 'permission-denied' });

        // setup/status, then the scenes' three listeners: the newest harvest, the scenes and (M4) the orders.
        expect(denials.count).toBe(4);
    });
});
