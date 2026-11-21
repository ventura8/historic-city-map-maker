// M20's Import local files (docs/research/M20-import-local.md §8): the feed the Upload view's card and an archive's report follow,
// over the fake store, the fake clock and the fake callables.
import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { createArchiveFeed, type ArchiveState } from '../../src/archive/feed.js';
import { IMAGERY_MODULE } from '../../src/imagery/imagery.js';
import { failure } from '../app/fakes.js';
import { at, CITY, contentWorld, type ContentWorld } from '../content/world.js';
import { cityDoc, golden } from '../imagery/world.js';

const ARCHIVE = 'ar-0123456789abcdef';
const WORKER = 'w-0123456789abcdef';
const SID = (n: number): string => `s-${String(n).padStart(12, '0')}`;
const T0 = '2026-11-09T08:00:00.000Z';
const CLEAR = { licence: 'PD', state: 'clear', year: '1911' } as const;
const UNCONFIRMED = { licence: 'unknown', state: 'needs-confirmation', year: '1977', author: 'IPB' } as const;

function series(n: number, more: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        seriesId: SID(n),
        class: 'grid',
        title: `Plan ${String(n)}`,
        year: 1911,
        files: 4,
        bytes: 4_000_000,
        action: 'import',
        encoding: 'lineart',
        rights: CLEAR,
        estimate: { maxzoom: 19, tilesBytes: 1_000_000_000, minutes: 75, auto: 'likely' },
        order: n,
        ...more,
    };
}

function archiveDoc(more: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        ...{ name: 'harti.zip', source: 'zip', fileCount: 120, bytes: 9_000_000, scannedAt: at(T0), workerId: WORKER },
        series: [
            series(0),
            series(1, { rights: UNCONFIRMED, year: 1977 }),
            series(2, { year: 1770 }),
            series(3, { action: 'skip', reason: 'do-not-publish' }),
        ],
        skipped: { 'not-a-map': 3, 'duplicate-of': 10 },
        ...{ createdBy: 'admin-uid', updatedBy: 'admin-uid', updatedAt: at(T0) },
        ...more,
    };
}

function workerDoc(seenAt: string, more: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        ...{ uid: 'admin-uid', version: '1.0.0', startedAt: at(seenAt), lastSeenAt: at(seenAt), state: 'idle' },
        ...{ updatedBy: 'system:worker', updatedAt: at(seenAt), ...more },
    };
}

/** The fields an archive series' version never has (it is many scans). */
const SCAN_FIELDS = new Set(['scan', 'reference', 'georef', 'sensor', 'date']);

/** An archive series' version (no scan, no georef), from the golden version. */
function archiveVersion(n: number, more: Record<string, unknown> = {}): Record<string, unknown> {
    const base = Object.fromEntries(Object.entries(golden('version.awaiting-approval.json')).filter(([key]) => !SCAN_FIELDS.has(key)));
    return {
        ...base,
        jobId: `job-${String(n)}`,
        origin: 'archive',
        source: { kind: 'archive', archiveId: ARCHIVE, seriesId: SID(n), sheetCount: 4 },
        ...more,
    };
}

function archiveJob(n: number, more: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        type: 'archive-series',
        status: 'queued',
        params: { archiveId: ARCHIVE, seriesId: SID(n), class: 'grid', sheets: 4, encoding: 'lineart', order: n, referenceLayerIds: [] },
        ...{ runOn: 'local', localOnly: true, versionId: `job-${String(n)}` },
        ...{ createdBy: 'admin-uid', createdAt: at(T0), updatedBy: 'system:imagery', updatedAt: at(T0), ...more },
    };
}

function feedOf(world: ContentWorld): { feed: ReturnType<typeof createArchiveFeed>; states: ArchiveState[] } {
    const feed = createArchiveFeed(world.services);
    const states: ArchiveState[] = [];
    feed.subscribe((state) => {
        states.push(state);
    });
    feed.start();
    return { feed, states };
}

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function seeded(): ContentWorld {
    const world = contentWorld();
    world.store.docs.set(FIRESTORE_PATHS.city(CITY), cityDoc({ limits: undefined }));
    world.store.docs.set(FIRESTORE_PATHS.archive(CITY, ARCHIVE), archiveDoc());
    return world;
}

describe('the archive feed', () => {
    it('happyPath_aFreshWorkerTheScannedArchivesAndTheWorkersPageWithTheCitysLatitude @S-A121-HAPPY-PANEL', () => {
        const world = seeded();
        world.store.docs.set(FIRESTORE_PATHS.worker(CITY, WORKER), workerDoc(new Date(world.clock.now() - 60_000).toISOString()));

        const { feed } = feedOf(world);

        expect(feed.state).toMatchObject({
            status: 'ready',
            connected: true,
            importUrl: 'http://127.0.0.1:8765/import?lat=44.4300',
        });
        expect(feed.state.archives).toEqual([{ id: ARCHIVE, name: 'harti.zip', files: 120, bytes: 9_000_000, series: 4, imported: false }]);
        world.clock.advance(180_000);
        expect(feed.state.connected).toBe(false);
        feed.stop();
        expect(world.store.listeners()).toBe(0);
    });

    it('badPath_noWorkerOrARevokedOneIsNotConnectedAndACityWithoutCentreUsesItsBounds @S-A121-BAD-NO-WORKER', () => {
        const world = contentWorld();
        world.store.docs.set(
            FIRESTORE_PATHS.city(CITY),
            cityDoc({
                center: undefined,
                limits: { computeUnitsPerMonth: 1, rasterJobsPerDay: 3, aiRequestsPerMonth: 1, geocodeCellsPerDay: 1, exportsPerDay: 1 },
            }),
        );
        world.store.docs.set(
            FIRESTORE_PATHS.worker(CITY, WORKER),
            workerDoc(new Date(world.clock.now()).toISOString(), { revokedAt: at(T0) }),
        );

        const { feed } = feedOf(world);

        expect(feed.state).toMatchObject({
            connected: false,
            importUrl: 'http://127.0.0.1:8765/import?lat=44.4500',
            archives: [],
        });
    });

    it('happyPath_theReportKeepsOnlySeriesALayerCanShowAndOneImportSendsTheOwnersEdits @S-A121-HAPPY-IMPORT', async () => {
        const world = seeded();
        world.callables.answer('imagery.archiveImport', () => ({
            jobs: [
                { seriesId: SID(0), jobId: 'job-0', layerId: 'plan-0', waiting: false },
                { seriesId: SID(1), jobId: 'job-1', layerId: 'plan-1', waiting: true },
            ],
            today: 1,
            waiting: 1,
        }));
        const { feed } = feedOf(world);

        feed.intents.open(ARCHIVE);
        const first = feed.state.edits;
        feed.intents.setTitle(SID(0), 'Planul IGA');
        feed.intents.setYear(SID(1), '1977');
        feed.intents.confirmRights(SID(1), '  Idei Urbane – DocuBucurești ');
        feed.intents.setInclude('s-nonexistent0', true);
        const imported = await feed.intents.import();

        expect(first[SID(0)]).toEqual({ include: true, title: 'Plan 0', year: '1911', confirmedBy: null });
        expect(first[SID(2)]?.include).toBe(false);
        expect(first[SID(3)]?.include).toBe(false);
        expect(feed.state.open?.report).toMatchObject({
            name: 'harti.zip',
            imported: false,
            importedSeries: [],
            skipped: [
                ['duplicate-of', 10],
                ['not-a-map', 3],
            ],
        });
        expect(imported).toBe(true);
        expect(world.callables.calls.at(-1)?.request).toEqual({
            cityId: CITY,
            archiveId: ARCHIVE,
            series: [
                { seriesId: SID(0), include: true, title: 'Planul IGA' },
                {
                    seriesId: SID(1),
                    include: true,
                    rights: { ...UNCONFIRMED, licence: 'permission', state: 'clear', confirmedBy: 'Idei Urbane – DocuBucurești' },
                },
            ],
        });
        expect(feed.state).toMatchObject({ importing: false, result: { today: 1, waiting: 1 } });
    });

    it('badPath_aYearALayerCannotShowOrNoSeriesChosenSendsNothingAndARefusalIsSaid @S-A121-BAD-YEAR-EMPTY', async () => {
        const world = seeded();
        world.callables.fail('imagery.archiveImport', failure('failed-precondition', 'apiError.imagery.archiveImported'));
        const { feed } = feedOf(world);
        expect(await feed.intents.import()).toBe(false);
        feed.intents.open(ARCHIVE);

        feed.intents.setYear(SID(0), '');
        const empty = await feed.intents.import();
        feed.intents.setYear(SID(0), '1911');
        feed.intents.setInclude(SID(0), false);
        feed.intents.setInclude(SID(1), false);
        const none = await feed.intents.import();
        feed.intents.setInclude(SID(0), true);
        feed.intents.confirmRights(SID(0), '   ');
        const refused = await feed.intents.import();

        expect([empty, none, refused]).toEqual([false, false, false]);
        expect(world.callables.calls.filter((call) => call.name === 'imagery.archiveImport')).toHaveLength(1);
        expect(feed.state.edits[SID(0)]?.confirmedBy).toBeNull();
        expect(feed.state.refusal).toEqual({ key: 'apiError.imagery.archiveImported' });
    });
});

describe('the archive feed, once imported', () => {
    it('happyPath_eachImportedSeriesShowsItsJobAndVersionWithItsErrorAndScaledThreshold @S-A121-HAPPY-PROGRESS', async () => {
        const world = seeded();
        world.store.docs.set(FIRESTORE_PATHS.archive(CITY, ARCHIVE), archiveDoc({ jobs: { [SID(0)]: 'job-0', [SID(1)]: 'job-1' } }));
        world.store.docs.set(FIRESTORE_PATHS.job(CITY, 'job-0'), archiveJob(0, { status: 'running', step: 'place', progress: 0.4 }));
        world.store.docs.set(FIRESTORE_PATHS.job(CITY, 'job-1'), archiveJob(1, { waitReason: 'daily' }));
        world.store.docs.set(FIRESTORE_PATHS.job(CITY, 'job-x'), { ...archiveJob(5), params: { entityId: 'x' }, type: 'usgs-import' });
        world.store.docs.set(
            FIRESTORE_PATHS.layerVersion(CITY, 'job-0'),
            archiveVersion(0, {
                archive: {
                    method: 'match',
                    encoding: 'colour',
                    paperTransparent: false,
                    scaleDenominator: 40_000,
                    checkpointRmseM: 38.2,
                    checkpointCount: 9,
                    checksDropped: 0,
                    measuredPct: 80,
                    rivalClean: true,
                },
            }),
        );
        world.store.docs.set(
            FIRESTORE_PATHS.layerVersion(CITY, 'job-1'),
            archiveVersion(1, {
                state: 'needs_gcps',
                output: undefined,
                help: { reason: 'frame-not-found', note: 'no neat line', at: at(T0) },
            }),
        );
        const { feed } = feedOf(world);

        feed.intents.open(ARCHIVE);
        feed.intents.open(ARCHIVE);
        await settle();

        expect(feed.state.open?.report?.imported).toBe(true);
        expect(feed.state.open?.report?.importedSeries).toEqual([SID(0), SID(1)]);
        expect(feed.state.progress[SID(0)]).toMatchObject({
            state: 'awaiting_approval',
            jobStatus: 'running',
            step: 'place',
            progress: 0.4,
            errorM: 38.2,
            thresholdM: 40,
        });
        expect(feed.state.progress[SID(1)]).toMatchObject({
            state: 'needs_gcps',
            waitReason: 'daily',
            help: { reason: 'frame-not-found', note: 'no neat line' },
            errorM: null,
            thresholdM: null,
        });
        feed.intents.open(null);
        expect(feed.state).toMatchObject({ open: null, progress: {} });
    });

    it('badPath_anArchiveNotFoundAListThatFailsAndARetry @S-A121-BAD-NOT-FOUND', () => {
        const world = contentWorld();
        const { feed } = feedOf(world);
        feed.intents.open('ar-ffffffffffffffff');
        expect(feed.state.open).toEqual({ id: 'ar-ffffffffffffffff', status: 'ready', report: null });

        world.store.fail(FIRESTORE_PATHS.archives(CITY), { kind: 'failed', code: 'internal' });
        expect(feed.state.status).toBe('error');
        feed.intents.retry();
        expect(feed.state.status).toBe('ready');
    });

    it('happyPath_theImageryStoreHandsOutTheFeedAndRegistersTheElements', async () => {
        const world = contentWorld();
        const store = IMAGERY_MODULE.create(world.services);

        const feed = await store.intents.archive();
        await store.intents.archiveElements();

        expect(feed.state.status).toBe('loading');
        expect(customElements.get('hcm-archive-report')).toBeDefined();
        store.destroy();
    });
});

describe('the archive feed: the admin tab’s import (batch 4)', () => {
    it('happyPath_importLocalAsksTheWorkerForASessionForTheCityAndTheStateFollows @S-A121-HAPPY-LOCAL-TAB', async () => {
        const world = seeded();
        const asked: unknown[] = [];
        const transport = {
            json: (path: string, body: unknown) => {
                asked.push([path, body]);
                return Promise.resolve({ status: 409, body: { error: 'notPaired' } });
            },
            upload: () => Promise.resolve(201),
        };
        const feed = createArchiveFeed(world.services, transport);
        feed.start();
        await settle();

        await feed.intents.importLocal([{ path: 'a.jpg', file: new Blob(['a']) }], 'folder', 'Harti');
        await feed.intents.cancelLocal();

        expect(asked).toEqual([['/import/session', { city: CITY }]]);
        expect(feed.state.local).toEqual({ phase: 'failed', percent: 0, done: 0, total: 0, error: 'notPaired' });
        feed.stop();
    });
});
