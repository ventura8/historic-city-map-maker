/**
 * Settings → Export the city (`packages/admin/src/export/`, M5 §5.6; behaviour A53): the card's live state (the latest
 * export, published or not, the owner, the USGS scans) and its intents: Export asks `export.start` once nothing is under
 * way, Download asks `export.download` for the address the page saves; refusals are the snackbar's.
 */
import { FIRESTORE_PATHS, type AdminDoc, type CityExportDoc, type LayerVersionDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { ExportSection, NO_EXPORT_SECTION, refusalOf, type ExportSectionState } from '../../src/export/export-section.js';
import { exportRecordItem, exportScans, ownsCity, wasPublished } from '../../src/export/model.js';
import { settingsModule } from '../../src/settings/settings.js';
import { failure, settle } from '../app/fakes.js';
import { at, CITY, contentWorld, type ContentWorld } from '../content/world.js';
import { cityDoc, CITY_PATH, LAYER_PATH, layerDoc } from '../layers/fixtures.js';

const UID = 'admin-uid';
const EXPORTS = FIRESTORE_PATHS.cityExports(CITY);
const MANIFEST = FIRESTORE_PATHS.manifestState(CITY);
const ADMIN = FIRESTORE_PATHS.admin(UID);
/** The fake clock's time (`FakeClock.current`): 2025-10-09T08:53:20Z. */
const NOW = '2025-10-09T08:53:20.000Z';

function admin(cities: AdminDoc['cities']): AdminDoc {
    return { role: 'admin', ...(cities === undefined ? {} : { cities }), createdAt: at(NOW), updatedBy: UID, updatedAt: at(NOW) };
}

function record(overrides: Partial<CityExportDoc> = {}): CityExportDoc {
    return {
        state: 'queued',
        requestedBy: UID,
        rasters: false,
        engineVersion: '1.0.0',
        createdAt: at(NOW),
        updatedBy: UID,
        updatedAt: at(NOW),
        ...overrides,
    };
}

function version(layerId: string, cogBytes: number): LayerVersionDoc {
    return {
        layerId,
        jobId: `v-${layerId}`,
        origin: 'usgs',
        state: 'published',
        label: { ro: layerId },
        year: 1966,
        output: {
            cogPath: `rasters/${CITY}/${layerId}/v/cog.tif`,
            cogBytes,
            cogSha256: 'c'.repeat(64),
            previewPath: `rasters/${CITY}/${layerId}/v/preview.png`,
            bounds: { west: 26, south: 44.4, east: 26.2, north: 44.5 },
            minzoom: 10,
            maxzoom: 16,
            areaKm2: 12,
        },
        mapbox: { tilesetId: 'e2e-user.x', origin: 'mts' },
        createdBy: UID,
        createdAt: at(NOW),
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
    };
}

/** A published city of `admin-uid`'s own, with a USGS layer of 2.5 MB and an uploaded one. */
function seeded(world: ContentWorld, cities: AdminDoc['cities'] = { [CITY]: 'owner' }): void {
    world.store.docs.set(ADMIN, admin(cities));
    world.store.docs.set(MANIFEST, {
        requestedVersion: 1,
        builtVersion: 1,
        status: 'idle',
        url: 'https://storage.googleapis.com/demo-hcm-public/cities/bucharest/manifest.json',
        updatedBy: 'system:publish',
        updatedAt: at(NOW),
    });
    world.store.docs.set(LAYER_PATH('corona'), layerDoc({ currentVersion: 'v-corona', provenance: { usgsEntityId: 'DS1035-1057DA023' } }));
    world.store.docs.set(LAYER_PATH('plan'), layerDoc({ currentVersion: 'v-plan' }));
    world.store.docs.set(FIRESTORE_PATHS.layerVersion(CITY, 'v-corona'), version('corona', 2_500_000));
    world.store.docs.set(FIRESTORE_PATHS.layerVersion(CITY, 'v-plan'), version('plan', 9_000_000));
}

function opened(world: ContentWorld): { readonly section: ExportSection; readonly states: ExportSectionState[] } {
    const states: ExportSectionState[] = [];
    const section = new ExportSection(world.services, (state) => states.push(state));
    section.open();
    return { section, states };
}

describe('the export section', () => {
    it('happyPath_theOwnerSeesTheLatestExportAndTheScansOfTheUsgsLayers', () => {
        const world = contentWorld();
        seeded(world);
        world.store.docs.set(
            `${EXPORTS}/x-1`,
            record({ state: 'failed', error: 'apiError.internal', createdAt: at('2025-10-08T08:00:00Z') }),
        );
        world.store.docs.set(
            `${EXPORTS}/x-2`,
            record({
                state: 'ready',
                bytes: 1234,
                sha256: 'a'.repeat(64),
                expiresAt: at('2025-10-16T08:00:00Z'),
                counts: { photos: 3, restrictedPhotos: 1, layers: 2, rasters: 0, pois: 0 },
            }),
        );

        const { section } = opened(world);

        expect(section.state).toMatchObject({
            status: 'ready',
            owner: true,
            published: true,
            scans: { count: 1, bytes: 2_500_000 },
            latest: { id: 'x-2', state: 'ready', bytes: 1234, expiresAt: '2025-10-16T08:00:00.000Z', error: null },
        });
    });

    it('happyPath_exportAsksTheServerWithTheScansWhenTicked', async () => {
        const world = contentWorld();
        seeded(world);
        world.callables.answer('export.start', () => ({ exportId: 'x-1' }));
        const { section } = opened(world);

        await section.intents.startExport();
        section.intents.setExportScans(true);
        await section.intents.startExport();

        expect(world.callables.calls.map((call) => call.request)).toEqual([
            { cityId: CITY, rasters: false },
            { cityId: CITY, rasters: true },
        ]);
        expect(section.state.starting).toBe(false);
    });

    it('happyPath_downloadAsksForTheSignedAddressOfTheReadyExport', async () => {
        const world = contentWorld();
        seeded(world);
        world.store.docs.set(`${EXPORTS}/x-1`, record({ state: 'ready', expiresAt: at('2025-10-16T08:00:00Z') }));
        world.callables.answer('export.download', () => ({
            url: 'https://storage.googleapis.com/b/x.zip?sig',
            expiresAt: NOW,
            fileName: `${CITY}-2025-10-09.zip`,
        }));
        const { section } = opened(world);

        await expect(section.intents.downloadExport()).resolves.toEqual({
            url: 'https://storage.googleapis.com/b/x.zip?sig',
            fileName: `${CITY}-2025-10-09.zip`,
        });
        expect(world.callables.calls).toEqual([{ name: 'export.download', request: { cityId: CITY, exportId: 'x-1' } }]);
        expect(section.state.downloading).toBe(false);
    });
});

describe('the export section: what it refuses', () => {
    it('badPath_aReadyExportPastItsTimeReadsExpired_andDownloadsNothing', async () => {
        const world = contentWorld();
        seeded(world);
        world.store.docs.set(`${EXPORTS}/x-1`, record({ state: 'ready', expiresAt: at('2025-10-09T08:00:00Z') }));
        const { section } = opened(world);

        expect(section.state.latest?.state).toBe('expired');
        await expect(section.intents.downloadExport()).resolves.toBeNull();
        expect(world.callables.calls).toEqual([]);
    });

    it('badPath_aRefusedExportIsTheSnackbars', async () => {
        const world = contentWorld();
        seeded(world);
        world.callables.fail('export.start', failure('resource-exhausted', 'apiError.export.dailyLimit', { limit: '3' }));
        const { section } = opened(world);

        await section.intents.startExport();

        expect(world.notices).toEqual([{ key: 'apiError.export.dailyLimit', params: { limit: '3' } }]);
    });

    it('badPath_aRefusedDownloadIsTheSnackbars', async () => {
        const world = contentWorld();
        seeded(world);
        world.store.docs.set(`${EXPORTS}/x-1`, record({ state: 'ready', expiresAt: at('2025-10-16T08:00:00Z') }));
        world.callables.fail('export.download', failure('failed-precondition', 'apiError.export.expired'));
        const { section } = opened(world);

        await expect(section.intents.downloadExport()).resolves.toBeNull();

        expect(world.notices).toEqual([{ key: 'apiError.export.expired' }]);
    });

    it.each([
        ['an editor', (world: ContentWorld) => world.store.docs.set(ADMIN, admin({ [CITY]: 'editor' }))],
        ['an admin from before M5', (world: ContentWorld) => world.store.docs.set(ADMIN, admin(undefined))],
        ['a city never published', (world: ContentWorld) => world.store.docs.delete(MANIFEST)],
        ['an export under way', (world: ContentWorld) => world.store.docs.set(`${EXPORTS}/x-1`, record({ state: 'building' }))],
    ])('badPath_%s_cannotExport', async (_case, change) => {
        const world = contentWorld();
        seeded(world);
        change(world);
        const { section } = opened(world);

        await section.intents.startExport();

        expect(world.callables.calls).toEqual([]);
    });

    it('badPath_aRevokedAdminsPageExportsNothing', async () => {
        const world = contentWorld({ readOnly: () => true });
        seeded(world);
        const { section } = opened(world);

        await section.intents.startExport();

        expect(world.callables.calls).toEqual([]);
    });

    it('badPath_aRefusedListenerIsAnErrorWithTryAgain', () => {
        const world = contentWorld();
        seeded(world);
        const { section } = opened(world);

        world.store.fail(EXPORTS, { kind: 'failed', code: 'permission-denied' });
        expect(section.state).toMatchObject({ status: 'error', failure: { kind: 'failed', code: 'permission-denied' } });

        section.intents.retryExport();
        expect(section.state.status).toBe('ready');
    });

    it('badPath_aDeniedListenerMakesTheShellAskWhoThisIs', () => {
        const world = contentWorld();
        seeded(world);
        opened(world);

        world.store.fail(MANIFEST, { kind: 'denied', code: 'permission-denied' });

        expect(world.denials.count).toBe(1);
    });

    it('happyPath_closingDetachesEveryListenerAndStartsOver', () => {
        const world = contentWorld();
        seeded(world);
        const { section, states } = opened(world);

        section.close();

        expect(world.store.listeners()).toBe(0);
        expect(states.at(-1)).toEqual(NO_EXPORT_SECTION);
    });

    it('badPath_signedOutTheAdminsDocumentIsNotRead', () => {
        const world = contentWorld({ user: () => null });
        seeded(world);
        const { section } = opened(world);

        expect(world.store.listeners(ADMIN)).toBe(0);
        expect(section.state.status).toBe('loading');
    });
});

describe('the settings area holds the export section', () => {
    it('happyPath_itsListenersFollowTheSectionsRoute', async () => {
        const world = contentWorld();
        seeded(world);
        world.store.docs.set(CITY_PATH, cityDoc());
        const store = settingsModule({ passes: () => true }).create(world.services);

        store.open([]);
        expect(world.store.listeners(EXPORTS)).toBe(0);
        store.open(['export']);
        expect(world.store.listeners(EXPORTS)).toBe(1);
        expect(store.state.export).toMatchObject({ status: 'ready', owner: true });
        store.open(['export']);
        expect(world.store.listeners(EXPORTS)).toBe(1);
        store.open(['texts']);
        await settle();
        expect(world.store.listeners(EXPORTS)).toBe(0);
        expect(store.state.export).toEqual(NO_EXPORT_SECTION);
        store.close();
    });
});

describe('the export model', () => {
    it('happyPath_onlyTheOwnerOfTheCityExports', () => {
        expect(ownsCity(admin({ [CITY]: 'owner' }), CITY)).toBe(true);
        expect(ownsCity(admin({ cluj: 'owner', [CITY]: 'editor' }), CITY)).toBe(false);
        expect(ownsCity(admin(undefined), CITY)).toBe(false);
        expect(ownsCity(null, CITY)).toBe(false);
    });

    it('happyPath_aCityIsPublishedOnceItsFirstBuildWroteAManifest', () => {
        expect(wasPublished(null)).toBe(false);
        expect(
            wasPublished({ requestedVersion: 1, builtVersion: 0, status: 'building', updatedBy: 'system:publish', updatedAt: at(NOW) }),
        ).toBe(false);
    });

    it('badPath_anUnpublishedLayerOrOneWithoutItsVersionAddsNoScan', () => {
        const stored = <T>(id: string, data: T) => ({ id, path: id, data, version: NOW, pending: false });
        const usgs = { provenance: { usgsEntityId: 'DS1' } };

        expect(
            exportScans(
                [
                    stored('a', layerDoc({ ...usgs, currentVersion: 'v-a', published: false })),
                    stored('b', layerDoc({ ...usgs, currentVersion: 'v-gone' })),
                    stored('c', layerDoc(usgs)),
                ],
                [stored('v-a', version('a', 5))],
            ),
        ).toEqual({ count: 0, bytes: 0 });
    });

    it('happyPath_aFailedExportCarriesItsCodeAndTheMessagesParameters', () => {
        const stored = <T>(id: string, data: T) => ({ id, path: id, data, version: NOW, pending: false });
        const failed = record({ state: 'failed', error: 'apiError.export.tooLarge', errorParams: { size: '3', max: '2' } });

        expect(exportRecordItem(stored('x-1', failed), 0).error).toEqual({
            code: 'apiError.export.tooLarge',
            params: { size: '3', max: '2' },
        });
        expect(exportRecordItem(stored('x-2', record({ state: 'failed', error: 'apiError.internal' })), 0).error).toEqual({
            code: 'apiError.internal',
            params: {},
        });
    });

    it('badPath_aVersionWithoutItsOutputAddsNoScan', () => {
        const stored = <T>(id: string, data: T) => ({ id, path: id, data, version: NOW, pending: false });
        const bare: LayerVersionDoc = { ...version('a', 5), output: undefined };

        expect(
            exportScans([stored('a', layerDoc({ provenance: { usgsEntityId: 'DS1' }, currentVersion: 'v-a' }))], [stored('v-a', bare)]),
        ).toEqual({ count: 0, bytes: 0 });
    });

    it('badPath_aFailureThatIsNoCallablesIsUnavailable', () => {
        expect(refusalOf(new Error('offline'))).toEqual({ key: 'apiError.unavailable' });
    });
});
