/**
 * M20's Import local files as the admin's pages show it (`docs/research/M20-import-local.md` §8), in the lazy `archive` chunk: whether
 * a worker of the city was seen within `WORKER_FRESH_SECONDS` (its import page is where files are chosen: a page of `web.app` cannot
 * reach the computer's loopback), the city's scanned archives (`cities/{city}/archives`, newest first), the routed archive's report
 * with the owner's edits (include, title, year, rights confirmed), the one Import click (`imagery.archiveImport`), and then each
 * series' progress from its version and its job, live. Batch 4: the folder or zip picked in the admin's own tab, streamed to the
 * worker with its progress and Cancel (`local-import.ts`).
 */
import {
    archiveDocSchema,
    cityDocSchema,
    FIRESTORE_PATHS,
    jobDocSchema,
    layerVersionDocSchema,
    WORKER_FRESH_SECONDS,
    WORKER_PORT,
    timestampSchema,
    type ArchiveDoc,
    type CityDoc,
    type ImageryArchiveImportRequest,
    type JobDoc,
    type LayerVersionDoc,
} from '@hcm/shared';
import { z } from 'zod';

import { LiveDoc, type DocState } from '../content/doc.js';
import { isoOf, LiveList, type ListState, type LoadStatus } from '../content/list.js';
import type { ContentServices, Stored, StoreFailure } from '../content/services.js';
import { refusalOf } from '../imagery/api.js';
import { Store } from '../state/store.js';
import type { NoticeInput } from '../state/state.js';
import type { LocalImport } from './local-import.js';
import { LOCAL_IDLE, type LocalFile, type LocalImportState, type LocalTransport } from './local-state.js';
import {
    choicesOf,
    editsOf,
    importUrlOf,
    latitudeOf,
    progressOf,
    rowOf,
    skippedOf,
    type ArchiveRow,
    type SeriesEdit,
    type SeriesProgress,
} from './model.js';

interface OpenArchive {
    readonly id: string;
    readonly status: LoadStatus;
    readonly report: {
        readonly name: string;
        readonly files: number;
        readonly bytes: number;
        readonly series: ArchiveDoc['series'];
        readonly skipped: readonly (readonly [reason: string, count: number])[];
        readonly imported: boolean;
        /** The series the archive's record names (imported); the others may be imported later (left out, or started over). */
        readonly importedSeries: readonly string[];
    } | null;
}

/** The routed archive's report as the page reads it. */
function reportOf(archive: ArchiveDoc): NonNullable<OpenArchive['report']> {
    return {
        name: archive.name,
        files: archive.fileCount,
        bytes: archive.bytes,
        series: archive.series,
        skipped: skippedOf(archive),
        imported: archive.jobs !== undefined,
        importedSeries: Object.keys(archive.jobs ?? {}),
    };
}

export interface ArchiveState {
    readonly status: LoadStatus;
    readonly failure: StoreFailure | null;
    readonly connected: boolean;
    readonly importUrl: string;
    readonly archives: readonly ArchiveRow[];
    readonly open: OpenArchive | null;
    readonly edits: Readonly<Record<string, SeriesEdit>>;
    readonly progress: Readonly<Record<string, SeriesProgress>>;
    readonly importing: boolean;
    readonly result: { readonly today: number; readonly waiting: number } | null;
    readonly refusal: NoticeInput | null;
    /** Batch 4: the folder or zip on its way to the worker, and its scan. */
    readonly local: LocalImportState;
}

interface ArchiveIntents {
    open(archiveId: string | null): void;
    setInclude(seriesId: string, include: boolean): void;
    setTitle(seriesId: string, title: string): void;
    setYear(seriesId: string, year: string): void;
    confirmRights(seriesId: string, by: string): void;
    import(): Promise<boolean>;
    retry(): void;
    /** Batch 4: sends the picked files (a folder's, or one zip) to the worker and follows its scan. */
    importLocal(files: readonly LocalFile[], source: 'folder' | 'zip', name: string): Promise<void>;
    cancelLocal(): Promise<void>;
}

const INITIAL: ArchiveState = {
    ...{ status: 'loading', failure: null, connected: false, importUrl: importUrlOf(WORKER_PORT, undefined), archives: [] },
    ...{ open: null, edits: {}, progress: {}, importing: false, result: null, refusal: null, local: LOCAL_IDLE },
};

/**
 * What the card reads of a worker: when it was last seen and whether it was disconnected. A projection of `workerDocSchema`, so the
 * worker's schema stays in the `worker` chunk (with it here it moved to `editor-shared`, past its 13 KB).
 */
const workerSightSchema = z.looseObject({ lastSeenAt: timestampSchema, revokedAt: timestampSchema.optional() });

type WorkerSight = z.infer<typeof workerSightSchema>;

function seenAtOf(doc: Stored<WorkerSight>): number {
    return doc.data.revokedAt === undefined ? Date.parse(isoOf(doc.data.lastSeenAt)) : 0;
}

const stored = <T>(doc: Stored<T>): Stored<T> => doc;

type ImportRequest = Omit<ImageryArchiveImportRequest, 'cityId'>;

export class ArchiveFeed {
    readonly #services: ContentServices;
    readonly #cell: Store<ArchiveState>;
    readonly #archives: LiveList<ArchiveDoc, ArchiveRow>;
    readonly #workers: LiveList<WorkerSight, number>;
    readonly #city: LiveDoc<CityDoc>;
    readonly #archive: LiveDoc<ArchiveDoc>;
    readonly #versions: LiveList<LayerVersionDoc, Stored<LayerVersionDoc>>;
    readonly #jobs: LiveList<JobDoc, Stored<JobDoc>>;
    readonly intents: ArchiveIntents;
    readonly #transport: LocalTransport | undefined;
    #local: Promise<LocalImport> | null = null;
    #stale: unknown = null;

    constructor(services: ContentServices, transport?: LocalTransport) {
        this.#services = services;
        this.#cell = new Store<ArchiveState>(INITIAL, services.log);
        this.#transport = transport;
        const { store, clock, cityId } = services;
        const denied = (): void => {
            services.denied();
        };
        const common = { store, clock, denied };
        this.#archives = new LiveList({
            ...{ ...common, collection: FIRESTORE_PATHS.archives(cityId), schema: archiveDocSchema, map: rowOf },
            changed: (list) => {
                this.#cell.update({ status: list.status, failure: list.failure, archives: list.items });
            },
        });
        this.#workers = new LiveList({
            ...{ ...common, collection: FIRESTORE_PATHS.workers(cityId), pageSize: 1, schema: workerSightSchema, map: seenAtOf },
            changed: (list) => {
                this.#seen(list);
            },
        });
        this.#city = new LiveDoc({
            ...{ ...common, schema: cityDocSchema },
            changed: () => {
                this.#cityRead();
            },
        });
        this.#archive = new LiveDoc({
            ...{ ...common, schema: archiveDocSchema },
            changed: (state) => {
                this.#archiveRead(state);
            },
        });
        const progressed = (): void => {
            this.#progressed();
        };
        this.#versions = new LiveList({
            ...common,
            collection: FIRESTORE_PATHS.layerVersions(cityId),
            schema: layerVersionDocSchema,
            map: stored,
            changed: progressed,
        });
        this.#jobs = new LiveList({
            ...common,
            collection: FIRESTORE_PATHS.jobs(cityId),
            schema: jobDocSchema,
            map: stored,
            changed: progressed,
        });
        this.intents = this.#intentsOf();
    }

    get state(): ArchiveState {
        return this.#cell.state;
    }

    subscribe(listener: (state: ArchiveState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    start(): void {
        this.#archives.show({ orderBy: [['scannedAt', 'desc']] });
        this.#workers.show({ orderBy: [['lastSeenAt', 'desc']] });
        this.#city.show(FIRESTORE_PATHS.city(this.#services.cityId));
    }

    stop(): void {
        for (const live of [this.#archives, this.#workers, this.#city, this.#archive, this.#versions, this.#jobs]) {
            live.stop();
        }
        this.#services.clock.clearTimeout(this.#stale);
    }

    #intentsOf(): ArchiveIntents {
        return {
            open: (archiveId) => {
                this.#open(archiveId);
            },
            setInclude: (seriesId, include) => {
                this.#edit(seriesId, { include });
            },
            setTitle: (seriesId, title) => {
                this.#edit(seriesId, { title });
            },
            setYear: (seriesId, year) => {
                this.#edit(seriesId, { year });
            },
            confirmRights: (seriesId, by) => {
                this.#edit(seriesId, { confirmedBy: by.trim() === '' ? null : by.trim() });
            },
            import: () => this.#import(),
            retry: () => {
                this.#archives.retry();
                this.#archive.retry();
            },
            importLocal: async (files, source, name) => {
                const city = this.#city.state.doc?.data;
                const local = await this.#localImport();
                await local.run({ city: this.#services.cityId, latitude: latitudeOf(city), name, source, files });
            },
            cancelLocal: async () => {
                await (await this.#local)?.cancel();
            },
        };
    }

    /** Batch 4: the client of the worker's loopback, the lazy `local-run` chunk, fetched on the first pick. */
    #localImport(): Promise<LocalImport> {
        this.#local ??= import('./local-run.js').then((chunk) =>
            chunk.createLocalImport(this.#transport, this.#services.clock, (local) => {
                this.#cell.update({ local });
            }),
        );
        return this.#local;
    }

    #open(archiveId: string | null): void {
        const open = this.#cell.state.open;
        if (archiveId === (open === null ? null : open.id)) {
            return;
        }
        for (const live of [this.#archive, this.#versions, this.#jobs]) {
            live.stop();
        }
        this.#cell.update({ open: null, edits: {}, progress: {}, result: null, refusal: null });
        if (archiveId !== null) {
            this.#watch(archiveId);
        }
    }

    /** The archive's report, and its series' versions and jobs once it is imported. */
    #watch(archiveId: string): void {
        const { cityId } = this.#services;
        this.#cell.update({ open: { id: archiveId, status: 'loading', report: null } });
        this.#archive.show(FIRESTORE_PATHS.archive(cityId, archiveId));
        this.#versions.show({ where: [['source.archiveId', '==', archiveId]] });
        this.#jobs.show({ where: [['params.archiveId', '==', archiveId]] });
    }

    #archiveRead(state: DocState<ArchiveDoc>): void {
        const open = this.#cell.state.open;
        if (open === null) {
            return;
        }
        const archive = state.doc?.data;
        const report = archive === undefined ? null : reportOf(archive);
        const edits = archive === undefined ? {} : editsOf(archive, this.#cell.state.edits);
        this.#cell.update({ open: { id: open.id, status: state.status, report }, edits });
    }

    #cityRead(): void {
        const city = this.#city.state.doc?.data;
        this.#cell.update({ importUrl: importUrlOf(WORKER_PORT, city) });
        this.#progressed();
    }

    #progressed(): void {
        const versions = this.#versions.list.items;
        const jobs = this.#jobs.list.items;
        this.#cell.update({ progress: progressOf(versions, jobs, this.#city.state.doc?.data) });
    }

    #edit(seriesId: string, patch: Partial<SeriesEdit>): void {
        const edit = this.#cell.state.edits[seriesId];
        if (edit !== undefined) {
            this.#cell.update({ edits: { ...this.#cell.state.edits, [seriesId]: { ...edit, ...patch } }, refusal: null });
        }
    }

    /** The newest worker's sight: connected while it is fresh, a timer says when it no longer is. */
    #seen(list: ListState<number>): void {
        const { clock } = this.#services;
        const left = (list.items[0] ?? 0) + WORKER_FRESH_SECONDS * 1000 - clock.now();
        clock.clearTimeout(this.#stale);
        if (left > 0) {
            this.#stale = clock.setTimeout(() => {
                this.#cell.update({ connected: false });
            }, left);
        }
        this.#cell.update({ connected: left > 0 });
    }

    /** The open archive's series to import, or null (none read, none chosen, a year a layer cannot show, an import on its way). */
    #request(): ImportRequest | null {
        const doc = this.#archive.state.doc;
        if (doc === null || this.#cell.state.importing) {
            return null;
        }
        const series = choicesOf(doc.data, this.#cell.state.edits);
        return series === null ? null : { archiveId: doc.id, series };
    }

    async #import(): Promise<boolean> {
        const request = this.#request();
        if (request === null) {
            return false;
        }
        this.#cell.update({ importing: true, refusal: null, result: null });
        try {
            const answer = await this.#services.callables.call('imagery.archiveImport', { cityId: this.#services.cityId, ...request });
            this.#cell.update({ importing: false, result: { today: answer.today, waiting: answer.waiting } });
            return true;
        } catch (error) {
            this.#cell.update({ importing: false, refusal: refusalOf(error) });
            return false;
        }
    }
}

/** The archive's feed over the area's services (the Imagery store hands it to the elements: `ImageryIntents.archive`). */
export function createArchiveFeed(services: ContentServices, transport?: LocalTransport): ArchiveFeed {
    return new ArchiveFeed(services, transport);
}
