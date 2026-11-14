/**
 * The Imagery area's live reads (`docs/research/M3-interfaces.md` §2, §3.5): `setup/status` (can USGS search, are
 * downloads approved), the city (its imagery settings and its frame for the map), the newest harvest (one scene by
 * `harvestedAt`, for the automatic search), the scenes by score (free only while the filter says so: the
 * `downloadAvailable, rank.score` index), the unfinished versions (`state, updatedAt`), the unfinished jobs (`status,
 * createdAt`) and the budget guard (`ops/guard`, CR-M3-47), each attached again by itself after a dropped connection.
 * M4 (`docs/research/M4-interfaces.md` §1.7): the scenes that have an order, whatever the filters (Work's orders, and a
 * notification's link to an ordered scene while Free only hides it), and the routed scene read by its id (a scene the
 * filters hide or past the list's first page: an address shared or bookmarked). M8 (`docs/research/M8-join-interfaces.md`
 * §6): the server's plan of each date's whole-city layer, a document because the list above is paged and filtered.
 */
import {
    cityDocSchema,
    datePlanDocSchema,
    FIRESTORE_PATHS,
    imagerySettingsOf,
    jobDocSchema,
    layerVersionReadSchema,
    setupStatusReadSchema,
    usgsSceneDocSchema,
    type BBox,
    type CityDoc,
    type DatePlanDoc,
    type DatePlanRow,
    type ImagerySettings,
    type JobDoc,
    type LayerVersionDoc,
    type ServiceState,
    type SetupStatusDoc,
    type UsgsRole,
    type UsgsSceneDoc,
} from '@hcm/shared';
import { sourcesOf, type SourceChoices } from '@hcm/shared/sources';

import { LiveDoc, type DocState, type LiveDocDeps } from '../content/doc.js';
import { isoOf, LiveList, type ListState } from '../content/list.js';
import type { ContentQuery, ContentServices, Stored } from '../content/services.js';
import { ACTIVE_JOB_STATUSES } from '../jobs/jobs.js';
import { frameOf, type CityFrame } from '../layers/map-session.js';
import { GuardFeed, type GuardView } from './guard.js';
import { footprintColorsOf, type FootprintColors } from './imagery-map.js';
import { ORDERS_QUERY, ordersList } from './orders/feed.js';
import {
    jobProgressOf,
    OPEN_VERSION_STATES,
    sceneItemOf,
    versionItemOf,
    type JobProgress,
    NO_NAMED_SCENE,
    type NamedScene,
    type SceneItem,
    type VersionItem,
} from './model.js';

/** Scenes per page of the list (the harvest keeps at most 500 per dataset). */
const SCENE_PAGE = 100;

export interface FeedsPatch {
    readonly usgs?: ServiceState | null;
    readonly settings?: ImagerySettings;
    /** M28: the city's sources. */
    readonly sources?: SourceChoices;
    readonly frame?: CityFrame;
    /** The city's bounds: the approval's city guard reads them. */
    readonly city?: BBox;
    /** The footprints' colours, from the city's theme (finding 51). */
    readonly colors?: FootprintColors;
    /** The newest harvest (ISO), null for none. */
    readonly newest?: string | null;
    readonly scenes?: ListState<SceneItem>;
    /** M4: the scenes that have an order. */
    readonly orders?: ListState<SceneItem>;
    /** The routed scene, read by its id. */
    readonly named?: NamedScene;
    readonly versions?: ListState<VersionItem>;
    readonly jobs?: Readonly<Record<string, JobProgress>>;
    readonly guard?: GuardView | null;
    /** M8: the plan's rows (none without a plan). */
    readonly dates?: readonly DatePlanRow[];
}

/** The scenes' query: best score first, free only when asked. */
export function scenesQuery(freeOnly: boolean): ContentQuery {
    return { where: freeOnly ? [['downloadAvailable', '==', true]] : [], orderBy: [['rank.score', 'desc']] };
}

/**
 * What USGS lets the Imagery area do, as a service state: a record whose last check found USGS not answering (a
 * maintenance window of the daily check) keeps what its role allows, `ok` with downloads approved, `pending` with the
 * search only (CR-M3-47): the area is not locked for the six hours to the next check, and USGS answers each call itself.
 */
function usgsOf(state: DocState<SetupStatusDoc>): ServiceState | null {
    return state.status === 'loading' ? null : usgsStateOf(state.doc?.data.usgs);
}

/** What each M2M role lets the area do while USGS did not answer its last check. */
const ROLE_STATES = { download: 'ok', search: 'pending' } as const satisfies Readonly<Record<UsgsRole, ServiceState>>;

function usgsStateOf(usgs: SetupStatusDoc['usgs']): ServiceState {
    if (usgs === undefined) {
        return 'missing';
    }
    return usgs.state === 'unavailable' && usgs.role !== undefined ? ROLE_STATES[usgs.role] : usgs.state;
}

/** The routed scene's read: loading until it answers, then the scene, null (no such scene) or why the read stopped. */
function namedOf(state: DocState<UsgsSceneDoc>): NamedScene {
    const failure = state.status === 'error' ? state.failure : null;
    return { loading: state.status === 'loading', scene: state.doc === null ? null : sceneItemOf(state.doc), failure };
}

/** The routed scene's own read, which reports `named`. */
function namedSceneDoc(
    base: Omit<LiveDocDeps<UsgsSceneDoc>, 'schema' | 'changed'>,
    changed: (patch: FeedsPatch) => void,
): LiveDoc<UsgsSceneDoc> {
    return new LiveDoc({
        ...base,
        schema: usgsSceneDocSchema,
        changed: (state) => {
            changed({ named: namedOf(state) });
        },
    });
}

/** M8: the plan of the dates, which reports its rows (none without a plan, or one that fails its schema). */
function planDoc(base: Omit<LiveDocDeps<DatePlanDoc>, 'schema' | 'changed'>, changed: (patch: FeedsPatch) => void): LiveDoc<DatePlanDoc> {
    return new LiveDoc({
        ...base,
        schema: datePlanDocSchema,
        changed: (state) => {
            changed({ dates: state.doc?.data.rows ?? [] });
        },
    });
}

const harvestedAtOf = (doc: Stored<UsgsSceneDoc>): string => isoOf(doc.data.harvestedAt);

export class ImageryFeeds {
    readonly #services: ContentServices;
    readonly #changed: (patch: FeedsPatch) => void;
    readonly #setup: LiveDoc<SetupStatusDoc>;
    readonly #city: LiveDoc<CityDoc>;
    readonly #newest: LiveList<UsgsSceneDoc, string>;
    readonly #scenes: LiveList<UsgsSceneDoc, SceneItem>;
    readonly #orders: LiveList<UsgsSceneDoc, SceneItem>;
    readonly #named: LiveDoc<UsgsSceneDoc>;
    readonly #versions: LiveList<LayerVersionDoc, VersionItem>;
    readonly #jobs: LiveList<JobDoc, JobProgress>;
    readonly #guard: GuardFeed;
    readonly #plan: LiveDoc<DatePlanDoc>;

    constructor(services: ContentServices, changed: (patch: FeedsPatch) => void) {
        this.#services = services;
        this.#changed = changed;
        const { store, clock, cityId } = services;
        const denied = (): void => {
            services.denied();
        };
        const base = { store, clock, denied };
        this.#setup = new LiveDoc({
            ...base,
            schema: setupStatusReadSchema,
            changed: (state) => {
                changed({ usgs: usgsOf(state) });
            },
        });
        this.#city = new LiveDoc({
            ...base,
            schema: cityDocSchema,
            changed: (state) => {
                this.#cityChanged(state);
            },
        });
        const scenes = { ...base, collection: FIRESTORE_PATHS.usgsScenes(cityId), schema: usgsSceneDocSchema };
        this.#newest = new LiveList({
            ...scenes,
            pageSize: 1,
            map: harvestedAtOf,
            changed: (list) => {
                this.#newestChanged(list);
            },
        });
        this.#scenes = new LiveList({
            ...scenes,
            pageSize: SCENE_PAGE,
            map: sceneItemOf,
            changed: (list) => {
                changed({ scenes: list });
            },
        });
        this.#orders = ordersList({ ...scenes, pageSize: SCENE_PAGE }, (orders) => {
            changed({ orders });
        });
        this.#named = namedSceneDoc(base, changed);
        this.#versions = new LiveList({
            ...{ ...base, collection: FIRESTORE_PATHS.layerVersions(cityId), schema: layerVersionReadSchema, map: versionItemOf },
            changed: (list) => {
                changed({ versions: list });
            },
        });
        this.#jobs = new LiveList({
            ...{ ...base, collection: FIRESTORE_PATHS.jobs(cityId), schema: jobDocSchema, map: jobProgressOf, pageSize: SCENE_PAGE },
            changed: (list) => {
                changed({ jobs: Object.fromEntries(list.items.map((job) => [job.id, job])) });
            },
        });
        this.#guard = new GuardFeed(services, (guard) => {
            changed({ guard });
        });
        this.#plan = planDoc(base, changed);
    }

    get active(): boolean {
        return this.#scenes.active;
    }

    /** The city document's version as read (null before it is): what a write of its imagery settings expects. */
    get cityVersion(): string | null {
        return this.#city.state.doc?.version ?? null;
    }

    start(freeOnly: boolean): void {
        this.#setup.show(FIRESTORE_PATHS.setupStatus);
        this.#city.show(FIRESTORE_PATHS.city(this.#services.cityId));
        this.#newest.show({ orderBy: [['harvestedAt', 'desc']] });
        this.#scenes.show(scenesQuery(freeOnly));
        this.#orders.show(ORDERS_QUERY);
        this.#versions.show({ where: [['state', 'in', OPEN_VERSION_STATES]], orderBy: [['updatedAt', 'desc']] });
        this.#jobs.show({ where: [['status', 'in', ACTIVE_JOB_STATUSES]], orderBy: [['createdAt', 'desc']] });
        this.#guard.start();
        this.#plan.show(FIRESTORE_PATHS.imageryPlan(this.#services.cityId));
    }

    /** The free-only filter changed: the scenes are read again. */
    showScenes(freeOnly: boolean): void {
        this.#scenes.show(scenesQuery(freeOnly));
    }

    /** The routed scene by its id, whatever the filters and the list's pages; null stops reading it. */
    showScene(id: string | null): void {
        if (id === null) {
            this.#named.stop();
            this.#changed({ named: NO_NAMED_SCENE });
            return;
        }
        const path = FIRESTORE_PATHS.usgsScene(this.#services.cityId, id);
        if (this.#named.path !== path) {
            this.#named.show(path);
        }
    }

    moreScenes(): void {
        this.#scenes.more();
    }

    retry(): void {
        for (const feed of [
            this.#setup,
            this.#city,
            this.#newest,
            this.#scenes,
            this.#orders,
            this.#versions,
            this.#jobs,
            this.#guard,
            this.#plan,
        ]) {
            feed.retry();
        }
        if (this.#named.path !== '') {
            this.#named.retry();
        }
    }

    stop(): void {
        for (const feed of [
            this.#setup,
            this.#city,
            this.#newest,
            this.#scenes,
            this.#orders,
            this.#named,
            this.#versions,
            this.#jobs,
            this.#guard,
            this.#plan,
        ]) {
            feed.stop();
        }
    }

    #cityChanged(state: DocState<CityDoc>): void {
        const city = state.doc?.data;
        if (city !== undefined) {
            this.#changed({
                ...{ settings: imagerySettingsOf(city.imagery), sources: sourcesOf(city.sources) },
                ...{ frame: frameOf(city), city: frameOf(city).bounds, colors: footprintColorsOf(city.theme) },
            });
        }
    }

    #newestChanged(list: ListState<string>): void {
        if (list.status === 'ready') {
            this.#changed({ newest: list.items[0] ?? null });
        }
    }
}
