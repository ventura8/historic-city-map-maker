/**
 * Settings → Export the city (M5, `docs/research/M5-interfaces.md` §5.6; behaviour A53): the card's live state and its
 * intents, open only while the section shows. It follows the city's latest export (queued, building, ready, failed,
 * expired), whether the city was ever published, whether the signed-in admin owns it, and the USGS scans an export may
 * carry; Export asks `export.start`, Download asks `export.download` for the signed address the page then downloads
 * (never shown). A refusal is the snackbar's; the record itself says how a build went.
 */
import {
    FIRESTORE_PATHS,
    MAX_LAYERS,
    adminDocSchema,
    cityExportDocSchema,
    layerDocSchema,
    layerVersionDocSchema,
    manifestStateDocSchema,
    type AdminDoc,
    type CityExportDoc,
    type LayerDoc,
    type LayerVersionDoc,
    type ManifestStateDoc,
} from '@hcm/shared';

import { LiveDoc, type DocState } from '../content/doc.js';
import { LiveList, type ListState, type LoadStatus } from '../content/list.js';
import type { ContentServices, Stored, StoreFailure } from '../content/services.js';
import { CallableFailure } from '../firebase/ports.js';
import type { NoticeInput } from '../state/state.js';
import { exportRecordItem, exportScans, NO_SCANS, ownsCity, wasPublished, type ExportRecordItem, type ExportScans } from './model.js';

export interface ExportSectionState {
    /** `loading` until every listener answered, `error` once one stopped (Try again restarts them). */
    readonly status: LoadStatus;
    readonly failure: StoreFailure | null;
    /** The signed-in admin owns the city: only an owner exports (`export.start` checks it too). */
    readonly owner: boolean;
    /** The city has a published manifest: a city never published cannot be exported. */
    readonly published: boolean;
    readonly latest: ExportRecordItem | null;
    readonly scans: ExportScans;
    /** Include the USGS scans (unticked at first). */
    readonly includeScans: boolean;
    readonly starting: boolean;
    readonly downloading: boolean;
}

export const NO_EXPORT_SECTION: ExportSectionState = {
    status: 'loading',
    failure: null,
    owner: false,
    published: false,
    latest: null,
    scans: NO_SCANS,
    includeScans: false,
    starting: false,
    downloading: false,
};

/** Where the page downloads a ready export from: the signed address and the name the browser saves it as. */
export interface ExportDownload {
    readonly url: string;
    readonly fileName: string;
}

export interface ExportIntents {
    setExportScans(on: boolean): void;
    startExport(): Promise<void>;
    /** The signed address of the latest ready export, or null (refused: the snackbar says why). */
    downloadExport(): Promise<ExportDownload | null>;
    retryExport(): void;
}

/** A failed call as the snackbar's notice (anything but a callable's refusal, such as the network, is unavailable). */
export function refusalOf(error: unknown): NoticeInput {
    if (!(error instanceof CallableFailure)) {
        return { key: 'apiError.unavailable' };
    }
    const { code, params } = error.details;
    return params === undefined ? { key: code } : { key: code, params };
}

interface Listeners {
    readonly exports: LiveList<CityExportDoc, ExportRecordItem>;
    readonly manifest: LiveDoc<ManifestStateDoc>;
    readonly admin: LiveDoc<AdminDoc>;
    readonly layers: LiveList<LayerDoc, Stored<LayerDoc>>;
    readonly versions: LiveList<LayerVersionDoc, Stored<LayerVersionDoc>>;
}

type Listened = DocState<unknown> | ListState<unknown>;

/** A live document's data, or null (loading, missing, or failed). */
function dataOf<T>(state: DocState<T>): T | null {
    return state.doc?.data ?? null;
}

function statusOf(states: readonly Listened[]): Pick<ExportSectionState, 'status' | 'failure'> {
    const failed = states.find((state) => state.status === 'error');
    if (failed !== undefined) {
        return { status: 'error', failure: failed.failure };
    }
    return { status: states.every((state) => state.status === 'ready') ? 'ready' : 'loading', failure: null };
}

/** An export still queued or building: Export waits for it. */
function isOpen(latest: ExportRecordItem | null): boolean {
    return latest !== null && (latest.state === 'queued' || latest.state === 'building');
}

export class ExportSection {
    readonly #services: ContentServices;
    readonly #changed: (state: ExportSectionState) => void;
    readonly #listeners: Listeners;
    #state: ExportSectionState = NO_EXPORT_SECTION;
    readonly intents: ExportIntents;

    constructor(services: ContentServices, changed: (state: ExportSectionState) => void) {
        this.#services = services;
        this.#changed = changed;
        this.#listeners = this.#create();
        this.intents = {
            setExportScans: (on) => {
                this.#set({ includeScans: on });
            },
            startExport: () => this.#start(),
            downloadExport: () => this.#download(),
            retryExport: () => {
                this.#each((listener) => {
                    listener.retry();
                });
            },
        };
    }

    get state(): ExportSectionState {
        return this.#state;
    }

    /** The section shows: every listener attaches (the admin's own document only while someone is signed in). */
    open(): void {
        const { cityId } = this.#services;
        const { exports, manifest, admin, layers, versions } = this.#listeners;
        exports.show({ orderBy: [['createdAt', 'desc']] });
        manifest.show(FIRESTORE_PATHS.manifestState(cityId));
        const uid = this.#services.user()?.uid;
        if (uid !== undefined) {
            admin.show(FIRESTORE_PATHS.admin(uid));
        }
        layers.show({ where: [['published', '==', true]] });
        versions.show({ where: [['state', '==', 'published']] });
    }

    /** The section is gone: every listener detaches and the card starts over next time. */
    close(): void {
        this.#each((listener) => {
            listener.stop();
        });
        this.#state = NO_EXPORT_SECTION;
        this.#changed(this.#state);
    }

    #create(): Listeners {
        const { store, clock, cityId } = this.#services;
        const denied = (): void => {
            this.#services.denied();
        };
        const changed = (): void => {
            this.#listened();
        };
        const keep = <T>(doc: Stored<T>): Stored<T> => doc;
        return {
            exports: new LiveList({
                ...{ store, clock, denied, changed, collection: FIRESTORE_PATHS.cityExports(cityId), schema: cityExportDocSchema },
                ...{ pageSize: 1, map: (doc: Stored<CityExportDoc>) => exportRecordItem(doc, clock.now()) },
            }),
            manifest: new LiveDoc({ store, clock, denied, changed, schema: manifestStateDocSchema }),
            admin: new LiveDoc({ store, clock, denied, changed, schema: adminDocSchema }),
            layers: new LiveList({
                store,
                clock,
                denied,
                changed,
                collection: FIRESTORE_PATHS.layers(cityId),
                schema: layerDocSchema,
                map: keep,
                pageSize: MAX_LAYERS,
            }),
            versions: new LiveList({
                ...{ store, clock, denied, changed, collection: FIRESTORE_PATHS.layerVersions(cityId), schema: layerVersionDocSchema },
                ...{ map: keep, pageSize: MAX_LAYERS },
            }),
        };
    }

    #each(work: (listener: { retry(): void; stop(): void }) => void): void {
        Object.values(this.#listeners).forEach(work);
    }

    #listened(): void {
        const { exports, manifest, admin, layers, versions } = this.#listeners;
        this.#set({
            ...statusOf([exports.list, manifest.state, admin.state, layers.list, versions.list]),
            owner: ownsCity(dataOf(admin.state), this.#services.cityId),
            published: wasPublished(dataOf(manifest.state)),
            latest: exports.list.items.at(0) ?? null,
            scans: exportScans(layers.list.items, versions.list.items),
        });
    }

    #set(patch: Partial<ExportSectionState>): void {
        this.#state = { ...this.#state, ...patch };
        this.#changed(this.#state);
    }

    /** Whether Export may run now: the owner of a published city, nothing under way, the page not read-only. */
    #canStart(): boolean {
        const state = this.#state;
        return state.owner && state.published && !isOpen(state.latest) && !(state.starting || this.#services.readOnly());
    }

    async #start(): Promise<void> {
        if (!this.#canStart()) {
            return;
        }
        this.#set({ starting: true });
        const rasters = this.#state.includeScans && this.#state.scans.count > 0;
        try {
            await this.#services.callables.call('export.start', { cityId: this.#services.cityId, rasters });
        } catch (error) {
            this.#services.notify(refusalOf(error));
        }
        this.#set({ starting: false });
    }

    async #download(): Promise<ExportDownload | null> {
        const latest = this.#state.latest;
        if (latest?.state !== 'ready' || this.#state.downloading) {
            return null;
        }
        this.#set({ downloading: true });
        try {
            const answer = await this.#services.callables.call('export.download', { cityId: this.#services.cityId, exportId: latest.id });
            return { url: answer.url, fileName: answer.fileName };
        } catch (error) {
            this.#services.notify(refusalOf(error));
            return null;
        } finally {
            this.#set({ downloading: false });
        }
    }
}
