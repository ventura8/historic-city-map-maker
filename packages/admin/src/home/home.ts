/**
 * The dashboard (`#/home`, the M2c brief's "dashboard home"; `docs/research/M2c-interfaces.md` §13, CR-M2c-24): what
 * the city holds (photos, places, categories, layers), what waits for an admin (photos in rights review, unpublished
 * photos, unfinished and failed jobs, from M3 the layer versions to approve or to georeference), the integrations' health from `setup/status` (one chip per Setup area, live) and
 * the public map's state from `manifests/{city}` (live). Counts are Firestore aggregations (one read per thousand
 * documents), counted when the page opens and on Refresh. M6 (setup-ux, `./reminders.ts`): what Setup left open, as
 * reminders: USGS later or waiting for its approval, a likely free trial nearing its end ("It is a paid account": one
 * input, recorded with `setup.recordCloud`). The owner, 2026-11-16: this month's costs, service by service (`./costs.ts`).
 */
import {
    FIRESTORE_PATHS,
    manifestStateDocSchema,
    SETUP_AREAS,
    setupStatusReadSchema,
    type CityRole,
    type ManifestStateDoc,
    type ServiceState,
    type SetupArea,
    type SetupStatusDoc,
} from '@hcm/shared';

import { outcomeOf } from '../app/services.js';
import type { AreaModule, AreaStore } from '../content/areas.js';
import { LiveDoc, LOADING_DOC, type DocState } from '../content/doc.js';
import { isoOf, type LoadStatus } from '../content/list.js';
import type { ContentQuery, ContentServices } from '../content/services.js';
import { ACTIVE_JOB_STATUSES } from '../jobs/jobs.js';
import type { NoticeInput } from '../state/state.js';
import { Store } from '../state/store.js';
import type { MonthlyCosts } from './costs.js';
import { remindersOf, type HomeReminder } from './reminders.js';

/** What the dashboard counts, in the order it shows them. */
const HOME_COUNTS = [
    ...['photos', 'pois', 'categories', 'layers', 'rightsReviews', 'unpublishedPhotos', 'activeJobs', 'failedJobs'],
    // M3 (admin-imagery): the layer versions waiting for an admin, an approval or georeferencing points.
    ...['versionsToApprove', 'versionsNeedingPoints'],
    // M18 item 7 (docs/research/M18-improvements.md): What needs you, with M13's role requests and suggestions (a count the
    // admin's role may not read, `READERS`, is not asked: nothing there for them, a zero; a count that failed is a dash, listed).
    ...['roleRequests', 'suggestionsToReview'],
    // The merge of M17 with M18 item 7: an uploader's story waiting in the review queue needs a reviewer too; and so do their
    // photos and places waiting there (DECISIONS-for-review.md §104c).
    ...['storiesToReview', 'photosToReview', 'placesToReview'],
] as const;

type HomeCount = (typeof HOME_COUNTS)[number];

/** Each count's collection and condition. */
const COUNT_QUERIES: Readonly<Record<HomeCount, { readonly collection: (cityId: string) => string; readonly query: ContentQuery }>> = {
    photos: { collection: FIRESTORE_PATHS.photos, query: {} },
    pois: { collection: FIRESTORE_PATHS.pois, query: {} },
    categories: { collection: FIRESTORE_PATHS.poiCategories, query: {} },
    layers: { collection: FIRESTORE_PATHS.layers, query: {} },
    rightsReviews: { collection: FIRESTORE_PATHS.photos, query: { where: [['rightsReview', '==', true]] } },
    unpublishedPhotos: { collection: FIRESTORE_PATHS.photos, query: { where: [['published', '==', false]] } },
    activeJobs: { collection: FIRESTORE_PATHS.jobs, query: { where: [['status', 'in', ACTIVE_JOB_STATUSES]] } },
    failedJobs: { collection: FIRESTORE_PATHS.jobs, query: { where: [['status', '==', 'failed']] } },
    versionsToApprove: { collection: FIRESTORE_PATHS.layerVersions, query: { where: [['state', '==', 'awaiting_approval']] } },
    versionsNeedingPoints: { collection: FIRESTORE_PATHS.layerVersions, query: { where: [['state', '==', 'needs_gcps']] } },
    roleRequests: { collection: FIRESTORE_PATHS.roleRequests, query: { where: [['status', '==', 'pending']] } },
    suggestionsToReview: { collection: FIRESTORE_PATHS.suggestions, query: { where: [['status', '==', 'pending']] } },
    storiesToReview: { collection: FIRESTORE_PATHS.stories, query: { where: [['reviewStatus', '==', 'pending']] } },
    photosToReview: { collection: FIRESTORE_PATHS.photos, query: { where: [['reviewStatus', '==', 'pending']] } },
    placesToReview: { collection: FIRESTORE_PATHS.pois, query: { where: [['reviewStatus', '==', 'pending']] } },
};

/** The counts the rules let only some roles read (`firestore.rules`: `isCityOwner`, `isCityReviewer`). */
const READERS: Partial<Record<HomeCount, readonly CityRole[]>> = {
    roleRequests: ['owner'],
    suggestionsToReview: ['owner', 'editor', 'moderator'],
    // An uploader reads only their own stories, photos and places (`firestore.rules`), so a count of every waiting one
    // would be refused.
    storiesToReview: ['owner', 'editor', 'moderator'],
    photosToReview: ['owner', 'editor', 'moderator'],
    placesToReview: ['owner', 'editor', 'moderator'],
};

/** Whether `role` may read the count (a role not known yet asks; the rules answer). */
function readable(name: HomeCount, role: CityRole | null): boolean {
    const readers = READERS[name];
    return readers === undefined || role === null || readers.includes(role);
}

/** One integration's chip: its Setup area, its state (`missing` until it was ever checked) and why. */
export interface HealthChip {
    readonly area: SetupArea;
    readonly state: ServiceState;
    readonly detail: NoticeInput | null;
}

/** A document the last manifest build left out, with its first issue (`manifests/{city}.skipped`). */
interface SkippedDocument {
    readonly entity: NonNullable<ManifestStateDoc['skipped']>[number]['entity'];
    readonly id: string;
    readonly code: NonNullable<ManifestStateDoc['skipped']>[number]['code'];
    readonly path: string;
}

/** The public map: the build's state, when it last published, the documents it left out (S-A38-BAD-SKIPPED-SHOWN). */
export interface PublicMapState {
    readonly status: ManifestStateDoc['status'];
    readonly builtAt: string | null;
    readonly skipped: readonly SkippedDocument[];
    readonly error: NoticeInput | null;
}

/** `setup/status` as chips (nothing checked yet: every chip `missing`). */
interface HealthState {
    readonly status: LoadStatus;
    readonly chips: readonly HealthChip[];
    readonly reconnecting: boolean;
}

export interface HomeState {
    readonly countsStatus: LoadStatus;
    /** Null for a count that failed (shown as a dash). */
    readonly counts: Readonly<Record<HomeCount, number | null>> | null;
    readonly health: HealthState;
    /** `manifests/{city}` (`doc` null: never built). */
    readonly publicMap: DocState<PublicMapState>;
    /** M6 setup-ux: what Setup left open (`./reminders.ts`), from `setup/status` and the clock. */
    readonly reminders: readonly HomeReminder[];
    /** "It is a paid account" is being recorded. */
    readonly dismissing: boolean;
    /** This month's costs, service by service (`./costs.ts`), live. */
    /** Null until the lazy `costs` chunk has loaded (its element and its watch). */
    readonly costs: MonthlyCosts | null;
}

export interface HomeIntents {
    /** Counts again (the live parts follow by themselves). */
    refresh(): Promise<void>;
    /** Try again after a listener's failure. */
    retry(): void;
    /** M6 setup-ux (A60): "It is a paid account" on the free-trial reminder (one input, `dismissTrial`). */
    dismissTrial(): Promise<void>;
}

const INITIAL: HomeState = {
    countsStatus: 'loading',
    counts: null,
    health: { status: 'loading', chips: [], reconnecting: false },
    publicMap: LOADING_DOC,
    reminders: [],
    dismissing: false,
    costs: null,
};

type HealthRecord = NonNullable<SetupStatusDoc[SetupArea]>;

function detailOf(record: HealthRecord | undefined): NoticeInput | null {
    if (record?.detail === undefined) {
        return null;
    }
    return record.params === undefined ? { key: record.detail } : { key: record.detail, params: record.params };
}

/** One chip per Setup area, in screen order. */
export function healthChipsOf(status: SetupStatusDoc | null): readonly HealthChip[] {
    return SETUP_AREAS.map((area) => {
        const record = status?.[area];
        return { area, state: record?.state ?? 'missing', detail: detailOf(record) };
    });
}

export function publicMapOf(manifest: ManifestStateDoc): PublicMapState {
    return {
        status: manifest.status,
        builtAt: manifest.builtAt === undefined ? null : isoOf(manifest.builtAt),
        skipped: manifest.skipped ?? [],
        error: manifest.error === undefined ? null : { key: manifest.error },
    };
}

function mapDoc<From, To>(state: DocState<From>, map: (data: From) => To): DocState<To> {
    return { ...state, doc: state.doc === null ? null : { ...state.doc, data: map(state.doc.data) } };
}

class HomeStore implements AreaStore<HomeState, HomeIntents> {
    readonly #services: ContentServices;
    readonly #cell: Store<HomeState>;
    readonly #status: LiveDoc<SetupStatusDoc>;
    readonly #manifest: LiveDoc<ManifestStateDoc>;
    #costs: { retry(): void; stop(): void } | null = null;
    #open = false;
    #counting = 0;
    readonly intents: HomeIntents;

    constructor(services: ContentServices) {
        this.#services = services;
        this.#cell = new Store<HomeState>(INITIAL, services.log);
        const { store, clock } = services;
        const denied = (): void => {
            services.denied();
        };
        this.#status = new LiveDoc({
            ...{ store, clock, denied, schema: setupStatusReadSchema },
            changed: (state) => {
                const status = state.doc?.data ?? null;
                this.#cell.update({
                    health: { status: state.status, chips: healthChipsOf(status), reconnecting: state.reconnecting },
                    reminders: remindersOf(status, clock.now(), services.adminRelease ?? null),
                });
            },
        });
        this.#manifest = new LiveDoc({
            ...{ store, clock, denied, schema: manifestStateDocSchema },
            changed: (state) => {
                this.#cell.update({ publicMap: mapDoc(state, publicMapOf) });
            },
        });
        this.intents = {
            refresh: () => this.#count(),
            retry: () => {
                this.#status.retry();
                this.#manifest.retry();
                this.#costs?.retry();
                void this.#count();
            },
            dismissTrial: () => this.#dismissTrial(),
        };
    }

    get state(): HomeState {
        return this.#cell.state;
    }

    subscribe(listener: (state: HomeState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    open(): void {
        if (this.#status.path === '') {
            this.#status.show(FIRESTORE_PATHS.setupStatus);
            this.#manifest.show(FIRESTORE_PATHS.manifestState(this.#services.cityId));
            this.#open = true;
            void this.#watchCosts();
            void this.#count();
        }
    }

    close(): void {
        this.#status.stop();
        this.#manifest.stop();
        this.#open = false;
        this.#costs?.stop();
        this.#costs = null;
    }

    hasUnsavedChanges(): boolean {
        return false;
    }

    destroy(): void {
        this.close();
        this.#counting += 1;
        this.#cell.update(INITIAL);
    }

    /** "It is a paid account": recorded for good; the live `setup/status` then drops the reminder, a failure is said. */
    async #dismissTrial(): Promise<void> {
        this.#cell.update({ dismissing: true });
        const outcome = await outcomeOf(() => this.#services.callables.call('setup.recordCloud', { trial: { paid: true } }));
        this.#cell.update({ dismissing: false });
        if (!outcome.ok) {
            this.#services.notify(outcome.error);
        }
    }

    /** The Monthly costs card's chunk (its element and its four counters), fetched when the dashboard opens. */
    async #watchCosts(): Promise<void> {
        const { CostsWatch, defineHcmHomeCosts } = await import('./costs.js');
        defineHcmHomeCosts();
        if (this.#open && this.#costs === null) {
            const watch = new CostsWatch(this.#services, (costs) => {
                this.#cell.update({ costs });
            });
            this.#costs = watch;
            watch.show();
        }
    }

    async #count(): Promise<void> {
        this.#counting += 1;
        const run = this.#counting;
        this.#cell.update({ countsStatus: 'loading' });
        const { store, cityId } = this.#services;
        const asked = HOME_COUNTS.filter((name) => readable(name, this.#services.cityRole()));
        const values = await Promise.all(
            asked.map((name) => store.count(COUNT_QUERIES[name].collection(cityId), COUNT_QUERIES[name].query)),
        );
        if (run === this.#counting) {
            const read = new Map(asked.map((name, index) => [name, values[index] ?? null]));
            const counts = Object.fromEntries(HOME_COUNTS.map((name) => [name, read.has(name) ? (read.get(name) ?? null) : 0])) as Record<
                HomeCount,
                number | null
            >;
            this.#cell.update({ counts, countsStatus: values.every((value) => value === null) ? 'error' : 'ready' });
        }
    }
}

export const HOME_MODULE: AreaModule<HomeState, HomeIntents> = {
    area: 'home',
    create: (services) => new HomeStore(services),
};
