// The ops pages' fixtures: their area states as the admin's stores would hold them, and mounting a page over a fake app
// whose area is a `FakeArea`.
import type { CityAdminsListResponse } from '@hcm/shared';
import { html } from 'lit';

import type { AdminsIntentsPort, AdminsViewState } from '../../../src/admin/admins/admins-port.js';
import type { ListStatePort } from '../../../src/admin/content-port.js';
import type { CrashesIntentsPort, CrashesViewState } from '../../../src/admin/crashes/crashes-port.js';
import type { HistoryIntentsPort, HistoryItemPort, HistoryViewState } from '../../../src/admin/history/history-port.js';
import type { HomeIntentsPort, HomeViewState } from '../../../src/admin/home/home-port.js';
import type { JobItemPort, JobsIntentsPort, JobsViewState } from '../../../src/admin/jobs/jobs-port.js';
import type { FakeArea } from '../editing/fake-area.js';
import { adminState, FakeAdminApp, mount, updated } from '../shell/fake-app.js';

/** The item at `index`; a missing one fails the test loudly. */
export function nth<T>(items: readonly T[], index: number): T {
    const item = items[index];
    if (item === undefined) {
        throw new Error(`no item ${String(index)}`);
    }
    return item;
}

export function ready<Item>(items: readonly Item[], more: Partial<ListStatePort<Item>> = {}): ListStatePort<Item> {
    return { status: 'ready', items, hasMore: false, reconnecting: false, failure: null, ...more };
}

export const LOADING = { status: 'loading', items: [], hasMore: false, reconnecting: false, failure: null } as const;

export function jobItem(overrides: Partial<JobItemPort> = {}): JobItemPort {
    return {
        id: 'b',
        type: 'usgs-import',
        status: 'running',
        finished: false,
        progress: 0.42,
        step: 'fetch',
        steps: [{ name: 'fetch', status: 'running' }],
        createdBy: 'owner-uid',
        createdAt: '2026-10-17T09:00:00.000Z',
        dispatchAt: null,
        cancelRequested: false,
        paused: false,
        error: null,
        ...{ waitReason: null, retryAt: null, versionId: null, retryable: false, rerunScene: null },
        ...overrides,
    };
}

export function jobsState(overrides: Partial<JobsViewState> = {}): JobsViewState {
    return {
        filter: 'all',
        list: ready([jobItem(), jobItem({ id: 'a', status: 'succeeded', finished: true, progress: 1 })]),
        detail: null,
        cancelling: false,
        retrying: false,
        rerunning: false,
        guard: null,
        resuming: false,
        pausingAll: false,
        ...overrides,
    };
}

export function historyItem(overrides: Partial<HistoryItemPort> = {}): HistoryItemPort {
    return {
        entryId: '1760700000000-pub',
        path: 'cities/bucharest/pois/gara/history/1760700000000-pub',
        entity: 'poi',
        entityId: 'gara',
        action: 'update',
        changedFields: ['published'],
        by: 'other-uid',
        at: '2026-10-17T10:00:00.000Z',
        revertOf: null,
        previous: { title: { ro: 'Gara de Nord', en: 'North Station' }, published: true },
        name: { ro: 'Gara de Nord', en: 'North Station' },
        ...overrides,
    };
}

export function historyState(overrides: Partial<HistoryViewState> = {}): HistoryViewState {
    return {
        filter: { entity: 'all', action: 'all' },
        recent: ready([
            historyItem(),
            historyItem({
                entryId: '1760710000000-del',
                entity: 'photo',
                entityId: 'foto',
                action: 'delete',
                by: 'system:photos',
                name: null,
                previous: { title: { ro: 'Foto' } },
            }),
        ]),
        document: null,
        selected: null,
        changes: [],
        reverting: null,
        refusal: null,
        people: { 'other-uid': 'Ion' },
        ...overrides,
    };
}

const ADMINS_LIST: CityAdminsListResponse = {
    admins: [
        {
            uid: 'owner-uid',
            role: 'owner',
            projectOwner: true,
            email: 'owner@e2e.test',
            displayName: 'Owner',
            createdAt: '2026-10-01T10:00:00.000Z',
            self: true,
        },
        {
            uid: 'admin-uid',
            role: 'editor',
            projectOwner: false,
            email: 'ana@e2e.test',
            createdAt: '2026-10-02T10:00:00.000Z',
            self: false,
        },
        { uid: 'quiet-uid', role: 'editor', projectOwner: false, createdAt: '2026-10-03T10:00:00.000Z', self: false },
    ],
    invites: [
        {
            inviteId: 'a'.repeat(64),
            role: 'editor',
            invitedBy: 'owner-uid',
            createdAt: '2026-10-10T10:00:00.000Z',
            expiresAt: '2026-10-24T10:00:00.000Z',
        },
    ],
};

export function adminsState(overrides: Partial<AdminsViewState> = {}): AdminsViewState {
    return { status: 'ready', list: ADMINS_LIST, failure: null, selected: null, invited: null, busy: false, ...overrides };
}

export function crashesState(overrides: Partial<CrashesViewState> = {}): CrashesViewState {
    return {
        period: 168,
        status: 'ready',
        groups: [
            {
                groupId: 'g1',
                message: 'TypeError: <b>x</b> is undefined',
                service: 'admin',
                version: '1.2.3',
                count: 1234,
                frames: ['at draw (https://demo-hcm.web.app/admin/assets/index.js:10:5)', 'at <b>run</b> (index.js:2:1)'],
                page: 'https://demo-hcm.web.app/admin/',
                client: 'Firefox 145 mobile',
                affectedUsers: 3,
                firstSeen: '2026-10-10T10:00:00.000Z',
                lastSeen: '2026-10-17T10:00:00.000Z',
                resolution: 'OPEN',
            },
            {
                groupId: 'g2',
                message: 'RangeError',
                service: 'viewer',
                count: 2,
                firstSeen: '2026-10-11T10:00:00.000Z',
                lastSeen: '2026-10-12T10:00:00.000Z',
                resolution: 'RESOLVED',
            },
        ],
        nextPageToken: null,
        loadingMore: false,
        failure: null,
        apiDisabled: false,
        selected: null,
        statistics: { days: 28, status: 'idle', problem: null, notice: null, numbers: null },
        ...overrides,
    };
}

export function homeState(overrides: Partial<HomeViewState> = {}): HomeViewState {
    return {
        countsStatus: 'ready',
        counts: {
            photos: 45,
            pois: 3,
            categories: 2,
            layers: 0,
            rightsReviews: 4,
            unpublishedPhotos: 0,
            activeJobs: 1,
            failedJobs: null,
            versionsToApprove: 2,
            versionsNeedingPoints: 0,
            roleRequests: 0,
            suggestionsToReview: 0,
            storiesToReview: 0,
            photosToReview: 0,
            placesToReview: 0,
        },
        health: {
            status: 'ready',
            reconnecting: false,
            chips: [
                { area: 'billing', state: 'ok', detail: null },
                { area: 'provision', state: 'ok', detail: null },
                { area: 'mapbox', state: 'invalid', detail: { key: 'apiError.mapbox.tokenInvalid' } },
                { area: 'usgs', state: 'pending', detail: null },
                { area: 'analytics', state: 'missing', detail: null },
                { area: 'crash', state: 'unavailable', detail: null },
            ],
        },
        publicMap: {
            status: 'ready',
            reconnecting: false,
            failure: null,
            doc: {
                id: 'bucharest',
                path: 'manifests/bucharest',
                version: '',
                pending: false,
                data: {
                    status: 'idle',
                    builtAt: '2026-10-17T09:00:00.000Z',
                    skipped: [
                        { entity: 'layer', id: 'corona-1968', code: 'validation.required', path: 'attribution' },
                        { entity: 'poiCategory', id: 'piete', code: 'validation.value', path: '' },
                        // M17: a story left out links to its editor too.
                        { entity: 'story', id: 'teatrul', code: 'validation.required', path: 'body' },
                    ],
                    error: null,
                },
            },
        },
        // M6 setup-ux: what Setup left open (none unless a test says so).
        reminders: [],
        dismissing: false,
        ...overrides,
    };
}

type AreaKey = 'admins' | 'history' | 'jobs' | 'crashes' | 'home';

interface Areas {
    readonly admins: FakeArea<AdminsViewState, AdminsIntentsPort>;
    readonly history: FakeArea<HistoryViewState, HistoryIntentsPort>;
    readonly jobs: FakeArea<JobsViewState, JobsIntentsPort>;
    readonly crashes: FakeArea<CrashesViewState, CrashesIntentsPort>;
    readonly home: FakeArea<HomeViewState, HomeIntentsPort>;
}

const TAGS: Readonly<Record<AreaKey, string>> = {
    admins: 'hcm-admins-page',
    history: 'hcm-history-page',
    jobs: 'hcm-jobs-page',
    crashes: 'hcm-crashes-list-page',
    home: 'hcm-home-page',
};

/** Mounts the page of `area` at `#/<area>/<params>` over an app whose store is `store`; `width` in CSS px. */
export async function page<K extends AreaKey>(
    area: K,
    store: Areas[K] | null,
    options: {
        readonly params?: readonly string[];
        readonly width?: number;
        readonly locale?: 'ro' | 'en';
        /** A revoked admin's read-only page (DECISIONS-for-review.md §42d). */
        readonly revoked?: boolean;
    } = {},
): Promise<{ readonly app: FakeAdminApp; readonly element: HTMLElement }> {
    const route = { id: area, params: options.params ?? [] };
    const app = new FakeAdminApp(adminState({ route, locale: options.locale ?? 'en', revoked: options.revoked === true }));
    app.areas[area] = store;
    const tag = TAGS[area];
    const element = await mount<HTMLElement>(html`<div class="box">${staticPage(tag, app)}</div>`, options.width ?? 1300);
    element.style.blockSize = '800px';
    await updated(element);
    const pageElement = nth([...element.querySelectorAll<HTMLElement>(tag)], 0);
    pageElement.style.blockSize = '800px';
    await updated(pageElement);
    return { app, element: pageElement };
}

function staticPage(tag: string, app: FakeAdminApp): HTMLElement {
    const element = document.createElement(tag) as HTMLElement & { app: unknown; state: unknown };
    element.app = app;
    element.state = app.state;
    return element;
}

/** Moves the app to another address (the outlet would set the new state). */
export async function route(app: FakeAdminApp, element: HTMLElement, params: readonly string[], locale: 'ro' | 'en' = 'en'): Promise<void> {
    app.set({ route: { id: app.state.route.id, params }, locale });
    (element as HTMLElement & { state: unknown }).state = app.state;
    await updated(element);
}
