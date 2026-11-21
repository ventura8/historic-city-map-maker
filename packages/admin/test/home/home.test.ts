import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { RECONNECT_DELAYS_MS } from '../../src/content/live.js';
import { healthChipsOf, HOME_MODULE, publicMapOf } from '../../src/home/home.js';
import { at, CITY, contentWorld } from '../content/world.js';

const STAMP = { updatedBy: 'system:ops', updatedAt: at('2026-10-17T10:00:00Z') };

function seeded() {
    const world = contentWorld();
    const docs: [string, Record<string, unknown>][] = [
        [`${FIRESTORE_PATHS.photos(CITY)}/p1`, { rightsReview: true, published: false }],
        [`${FIRESTORE_PATHS.photos(CITY)}/p2`, { rightsReview: false, published: true }],
        [`${FIRESTORE_PATHS.photos(CITY)}/p3`, { rightsReview: false, published: false, reviewStatus: 'pending' }],
        [`${FIRESTORE_PATHS.pois(CITY)}/x`, { published: true }],
        [`${FIRESTORE_PATHS.pois(CITY)}/y`, { published: false, reviewStatus: 'pending' }],
        [`${FIRESTORE_PATHS.pois(CITY)}/z`, { published: false, reviewStatus: 'pending' }],
        [`${FIRESTORE_PATHS.jobs(CITY)}/j1`, { status: 'running' }],
        [`${FIRESTORE_PATHS.jobs(CITY)}/j2`, { status: 'failed' }],
        [
            FIRESTORE_PATHS.setupStatus,
            {
                billing: { state: 'ok' },
                mapbox: { state: 'invalid', detail: 'apiError.mapbox.tokenInvalid' },
                usgs: { state: 'pending', detail: 'apiError.cloud.permission', params: { role: 'x' } },
                ...STAMP,
            },
        ],
        [
            FIRESTORE_PATHS.manifestState(CITY),
            {
                requestedVersion: 3,
                builtVersion: 3,
                status: 'idle',
                builtAt: at('2026-10-17T09:00:00Z'),
                skipped: [{ entity: 'photo', id: 'p9', code: 'validation.required', path: 'title' }],
                ...STAMP,
            },
        ],
    ];
    for (const [path, data] of docs) {
        world.store.docs.set(path, data);
    }
    return world;
}

async function settled(): Promise<void> {
    for (let round = 0; round < 10; round += 1) {
        await Promise.resolve();
    }
}

describe('the dashboard', () => {
    it('happyPath_countsTheCityAndWhatWaitsAndFollowsTheServicesAndThePublicMap', async () => {
        const { services } = seeded();
        const home = HOME_MODULE.create(services);

        home.open([]);
        await settled();

        expect(home.state.counts).toEqual({
            photos: 3,
            pois: 3,
            categories: 0,
            layers: 0,
            rightsReviews: 1,
            unpublishedPhotos: 2,
            activeJobs: 1,
            failedJobs: 1,
            versionsToApprove: 0,
            versionsNeedingPoints: 0,
            roleRequests: 0,
            suggestionsToReview: 0,
            storiesToReview: 0,
            photosToReview: 1,
            placesToReview: 2,
        });
        expect(home.state.health.chips.map((chip) => [chip.area, chip.state])).toEqual([
            ['billing', 'ok'],
            ['provision', 'missing'],
            ['mapbox', 'invalid'],
            ['usgs', 'pending'],
            ['analytics', 'missing'],
            ['crash', 'missing'],
        ]);
        expect(home.state.health.chips[3]?.detail).toEqual({ key: 'apiError.cloud.permission', params: { role: 'x' } });
        expect(home.state.publicMap.doc?.data).toEqual({
            status: 'idle',
            builtAt: '2026-10-17T09:00:00.000Z',
            skipped: [{ entity: 'photo', id: 'p9', code: 'validation.required', path: 'title' }],
            error: null,
        });
        expect([HOME_MODULE.area, home.hasUnsavedChanges()]).toEqual(['home', false]);
    });

    it('happyPath_liveChangesAndRefreshCountsAgain', async () => {
        const { services, store } = seeded();
        const home = HOME_MODULE.create(services);
        home.open([]);
        home.open([]);
        await settled();

        store.put(FIRESTORE_PATHS.manifestState(CITY), {
            requestedVersion: 4,
            builtVersion: 3,
            status: 'failed',
            error: 'apiError.internal',
            ...STAMP,
        });
        store.docs.set(`${FIRESTORE_PATHS.photos(CITY)}/p4`, { rightsReview: true });
        await home.intents.refresh();

        expect(home.state.publicMap.doc?.data).toEqual({
            status: 'failed',
            builtAt: null,
            skipped: [],
            error: { key: 'apiError.internal' },
        });
        expect(home.state.counts?.photos).toBe(4);
    });

    it('badPath_failedCountsAreDashesAndAllFailedIsAnError', async () => {
        const { services, store } = seeded();
        store.counts.set(FIRESTORE_PATHS.layers(CITY), null);
        const home = HOME_MODULE.create(services);
        home.open([]);
        await settled();
        expect(home.state.counts?.layers).toBeNull();
        expect(home.state.countsStatus).toBe('ready');

        for (const path of [
            FIRESTORE_PATHS.photos(CITY),
            FIRESTORE_PATHS.pois(CITY),
            FIRESTORE_PATHS.poiCategories(CITY),
            FIRESTORE_PATHS.jobs(CITY),
            FIRESTORE_PATHS.layerVersions(CITY),
            FIRESTORE_PATHS.roleRequests(CITY),
            FIRESTORE_PATHS.suggestions(CITY),
            FIRESTORE_PATHS.stories(CITY),
        ]) {
            store.counts.set(path, null);
        }
        await home.intents.refresh();

        expect(home.state.countsStatus).toBe('error');
    });

    it('badPath_nothingCheckedYetAndListenersThatDropOrAreRefused', async () => {
        const { services, store, clock, denials } = contentWorld();
        const home = HOME_MODULE.create(services);
        home.open([]);
        await settled();
        expect(home.state.health.chips.every((chip) => chip.state === 'missing' && chip.detail === null)).toBe(true);
        expect(home.state.publicMap).toMatchObject({ status: 'ready', doc: null });

        store.fail(FIRESTORE_PATHS.setupStatus, { kind: 'unavailable', code: 'unavailable' });
        expect(home.state.health.reconnecting).toBe(true);
        clock.advance(RECONNECT_DELAYS_MS[0] ?? 0);
        store.fail(FIRESTORE_PATHS.setupStatus, { kind: 'denied', code: 'permission-denied' });
        store.fail(FIRESTORE_PATHS.manifestState(CITY), { kind: 'failed', code: 'internal' });
        expect([home.state.health.status, home.state.publicMap.status, denials.count]).toEqual(['error', 'error', 1]);
        home.intents.retry();
        await settled();

        expect([home.state.health.status, home.state.publicMap.status]).toEqual(['ready', 'ready']);
        home.destroy();
        expect(store.listeners()).toBe(0);
        let heard = 0;
        home.subscribe(() => {
            heard += 1;
        })();
        expect(heard).toBe(0);
    });

    it('happyPath_theMappingsOnTheirOwn', () => {
        expect(healthChipsOf(null)).toHaveLength(6);
        expect(publicMapOf({ requestedVersion: 1, builtVersion: 0, status: 'queued', ...STAMP })).toEqual({
            status: 'queued',
            builtAt: null,
            skipped: [],
            error: null,
        });
    });
});

describe('the dashboard: what the role may count', () => {
    // Review of M18 item 7: a count the role may not read is not asked (no dash for it); a refused count stays a dash.
    it('badPath_aCountTheRoleMayNotReadIsNotAsked_andARefusedOneStaysUnknown @S-A40-BAD-UPLOADER-NO-STORY-COUNT', async () => {
        const { services, store } = seeded();
        store.counts.set(FIRESTORE_PATHS.jobs(CITY), null);
        const moderator = HOME_MODULE.create({ ...services, cityRole: () => 'moderator' });
        const uploader = HOME_MODULE.create({ ...services, cityRole: () => 'uploader' });
        const unknown = HOME_MODULE.create({ ...services, cityRole: () => null });
        store.counts.set(FIRESTORE_PATHS.roleRequests(CITY), null);
        for (const home of [moderator, uploader, unknown]) {
            home.open([]);
        }
        await settled();

        expect([moderator.state.counts?.roleRequests, moderator.state.counts?.suggestionsToReview]).toEqual([0, 0]);
        expect([uploader.state.counts?.roleRequests, uploader.state.counts?.suggestionsToReview]).toEqual([0, 0]);
        // The merge of M17 with M18: an uploader is not asked every waiting story, photo or place (the rules read only their own).
        expect(uploader.state.counts?.storiesToReview).toBe(0);
        expect([uploader.state.counts?.photosToReview, uploader.state.counts?.placesToReview]).toEqual([0, 0]);
        expect([moderator.state.counts?.photosToReview, moderator.state.counts?.placesToReview]).toEqual([1, 2]);
        expect([unknown.state.counts?.roleRequests, unknown.state.counts?.failedJobs]).toEqual([null, null]);
        expect(moderator.state.counts?.failedJobs).toBeNull();
    });
});
