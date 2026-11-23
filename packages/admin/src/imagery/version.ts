/**
 * The version's page (`#/imagery/version/<versionId>`, `docs/research/M3-interfaces.md` §10.2): the version, its job
 * and the job's log lines, live, and this month's Mapbox usage (`usage/mapbox-YYYY-MM`) for the compute-unit figures;
 * and what the admin does there: Approve, Reject, a way out of a publish that does not fit the month (the free Studio
 * upload with its download and "I uploaded it", next month, or pay), Retry a failed job, Locate again a frame
 * waiting for points, Cancel an unfinished one. The
 * page asks before Reject, Pay and Cancel; every refusal stays on the card as its error code's text.
 */
import {
    FIRESTORE_PATHS,
    jobDocSchema,
    jobLogDocSchema,
    layerVersionDocSchema,
    layerVersionReadSchema,
    tilesetName,
    usageDocSchema,
    usageMonth,
    type AdminContentKey,
    type JobDoc,
    type JobLogDoc,
    type LayerVersionDoc,
    type PublishChoice,
    type UsageDoc,
} from '@hcm/shared';

import { LiveDoc, LOADING_DOC, type DocState } from '../content/doc.js';
import { isoOf, LiveList, LOADING_LIST, type ListState } from '../content/list.js';
import type { ContentServices, Stored } from '../content/services.js';
import type { NoticeInput } from '../state/state.js';
import { callImagery, refusalOf, type ImageryCallName, type ImageryRequest, type ImageryResponse } from './api.js';
import type { FilePort } from './files.js';
import { jobViewOf, versionViewOf, type JobView, type VersionView } from './version-view.js';

export type VersionAction =
    | 'approve'
    | 'reject'
    | 'confirmRights'
    | 'deleteVersion'
    | 'makeLive'
    | 'choose'
    | 'studioDone'
    | 'download'
    | 'retry'
    | 'locate'
    | 'fixTiles'
    | 'redraw'
    | 'cancel'
    | 'recalibrate';

export interface JobLogLine {
    readonly seq: number;
    readonly level: JobLogDoc['level'];
    readonly step: string | null;
    readonly message: string;
    readonly at: string;
}

export interface VersionPageState {
    readonly id: string;
    readonly version: DocState<VersionView>;
    readonly job: DocState<JobView>;
    readonly logs: ListState<JobLogLine>;
    /** This month's counters (null: none yet, the month is untouched). */
    readonly usage: UsageView | null;
    readonly acting: VersionAction | null;
    /** The last action's refusal, shown on the card. */
    readonly refusal: NoticeInput | null;
    /** The Studio file was saved (the next step is Mapbox Studio). */
    readonly downloaded: boolean;
    /** M16 (`docs/research/M16-recalibrate.md` §7): the version a recalibration would replace, and which of the two the map shows. */
    readonly current: VersionView | null;
    readonly showing: 'new' | 'current';
}

const LOG_LINES = 500;

/** The month's counters as the approval card reads them (absent ones are zero). */
interface UsageView {
    readonly computeUnits: number;
    readonly computeUnitBudget: number;
    readonly overageComputeUnits: number;
    readonly reservations: Readonly<Record<string, { readonly computeUnits: number }>>;
}

function usageViewOf(usage: UsageDoc): UsageView {
    return {
        ...{ computeUnits: usage.computeUnits, computeUnitBudget: usage.computeUnitBudget },
        ...{ overageComputeUnits: usage.overageComputeUnits ?? 0, reservations: usage.reservations ?? {} },
    };
}

function logLineOf(doc: Stored<JobLogDoc>): JobLogLine {
    const line = doc.data;
    return { seq: line.seq, level: line.level, step: line.step ?? null, message: line.message, at: isoOf(line.updatedAt) };
}

function mapped<From, To>(state: DocState<From>, map: (doc: Stored<From>) => To): DocState<To> {
    return { ...state, doc: state.doc === null ? null : { ...state.doc, data: map(state.doc) } };
}

interface StudioFile {
    readonly path: string;
    readonly name: string;
}

/** The Studio file of `version`, saved as `<tileset name>.tif` so the tileset Studio makes is named after it. */
function studioFileOf(cityId: string, version: VersionView): StudioFile | null {
    const path = version.output?.studioPath ?? null;
    return path === null ? null : { path, name: `${tilesetName(cityId, version.layerId)}.tif` };
}

/** M16: the version a recalibration was based on (none for any other version). */
function currentIdOf(version: VersionView | undefined): string | null {
    return version === undefined || version.recalibration === null ? null : version.basedOn;
}

function usageOf(state: DocState<UsageDoc>): UsageView | null {
    return state.doc === null ? null : usageViewOf(state.doc.data);
}

function emptyVersionPage(id: string): VersionPageState {
    return {
        ...{ id, version: LOADING_DOC, job: LOADING_DOC, logs: LOADING_LIST, usage: null, acting: null, refusal: null, downloaded: false },
        ...{ current: null, showing: 'new' as const },
    };
}

/** A recalibration whose current version is published (deleting it leaves that one on the map). */
function recalibratesPublished(version: VersionView | undefined, current: VersionView | null): boolean {
    if (version === undefined || version.recalibration === null) {
        return false;
    }
    return current?.state === 'published';
}

/** The notice of a Delete: a failed version's, a recalibration of a published one's, or any image's. */
function rejectNoticeOf(state: VersionPageState): AdminContentKey {
    const version = state.version.doc?.data;
    if (version?.state === 'failed') {
        return 'adminContent.imagery.notice.dismissed';
    }
    return recalibratesPublished(version, state.current)
        ? 'adminContent.imagery.notice.rejectedRecalibration'
        : 'adminContent.imagery.notice.rejected';
}

export class VersionPage {
    readonly #services: ContentServices;
    readonly #files: FilePort;
    readonly #changed: (state: VersionPageState | null) => void;
    readonly #version: LiveDoc<LayerVersionDoc>;
    readonly #job: LiveDoc<JobDoc>;
    readonly #usage: LiveDoc<UsageDoc>;
    readonly #logs: LiveList<JobLogDoc, JobLogLine>;
    /** M16: the version a recalibration was based on, read while the page shows the recalibration. */
    readonly #current: LiveDoc<LayerVersionDoc>;
    #currentId: string | null = null;
    #state: VersionPageState | null = null;

    constructor(services: ContentServices, files: FilePort, changed: (state: VersionPageState | null) => void) {
        this.#services = services;
        this.#files = files;
        this.#changed = changed;
        const { store, clock } = services;
        const denied = (): void => {
            services.denied();
        };
        const update = (): void => {
            this.#refresh();
        };
        this.#version = new LiveDoc({ store, clock, denied, schema: layerVersionReadSchema, changed: update });
        this.#job = new LiveDoc({ store, clock, denied, schema: jobDocSchema, changed: update });
        this.#usage = new LiveDoc({ store, clock, denied, schema: usageDocSchema, changed: update });
        this.#current = new LiveDoc({ store, clock, denied, schema: layerVersionDocSchema, changed: update });
        this.#logs = new LiveList({
            ...{ store, clock, denied, collection: '', schema: jobLogDocSchema, map: logLineOf, pageSize: LOG_LINES },
            changed: update,
        });
    }

    get state(): VersionPageState | null {
        return this.#state;
    }

    /** Opens version `id` (its job has the same id); null closes the page. */
    show(id: string | null): void {
        if (id === (this.#state?.id ?? null)) {
            return;
        }
        this.close();
        if (id === null) {
            return;
        }
        const { cityId } = this.#services;
        this.#set(emptyVersionPage(id));
        this.#version.show(FIRESTORE_PATHS.layerVersion(cityId, id));
        this.#job.show(FIRESTORE_PATHS.job(cityId, id));
        this.#usage.show(FIRESTORE_PATHS.usage(usageMonth(new Date(this.#services.clock.now()))));
        this.#logs.showIn(FIRESTORE_PATHS.jobLogs(cityId, id), { orderBy: [['seq', 'asc']] });
    }

    close(): void {
        this.#version.stop();
        this.#job.stop();
        this.#usage.stop();
        this.#logs.stop();
        this.#current.stop();
        this.#currentId = null;
        this.#set(null);
    }

    retryListeners(): void {
        if (this.#state !== null) {
            this.#version.retry();
            this.#job.retry();
            this.#logs.retry();
        }
    }

    /** M16: `acceptWorse` is the owner's choice of a recalibration not shown better (the page asks first). */
    approve(acceptWorse = false): Promise<boolean> {
        const choice = acceptWorse ? { acceptWorse: true as const } : {};
        return this.#act('approve', 'imagery.approve', (id) => ({ cityId: this.#services.cityId, versionId: id, ...choice }), {
            key: 'adminContent.imagery.notice.approved',
        });
    }

    /** M16: Refine automatically; the new version's id, or null when refused (the refusal stays on the card). */
    async recalibrate(): Promise<string | null> {
        const request = (id: string) => ({ cityId: this.#services.cityId, versionId: id, route: 'auto' as const });
        const answer = await this.#call('recalibrate', 'imagery.recalibrate', request, { key: 'adminContent.imagery.recalibrate.started' });
        return answer?.versionId ?? null;
    }

    /** M16: the map shows the current version instead of the new one, or back. */
    toggleCurrent(): void {
        const state = this.#state;
        if (state?.current !== null && state !== null) {
            this.#set({ ...state, showing: state.showing === 'new' ? 'current' : 'new' });
        }
    }

    /** Rejects a waiting version, or dismisses a failed one (the same call: CR-M3-47). */
    reject(): Promise<boolean> {
        const notice = { key: this.#rejectNotice() };
        return this.#act('reject', 'imagery.reject', (id) => ({ cityId: this.#services.cityId, versionId: id }), notice);
    }

    /** M20 (§7): the city's owner names who granted the permission; Approve stays disabled until rights are clear. */
    confirmRights(confirmedBy: string): Promise<boolean> {
        return this.#act(
            'confirmRights',
            'imagery.confirmRights',
            (id) => ({ cityId: this.#services.cityId, versionId: id, confirmedBy }),
            { key: 'adminContent.imagery.notice.rightsConfirmed' },
        );
    }

    /** Lesson 759: a superseded version whose own tiles are still public becomes the live one again (`imagery.makeLive`). */
    makeLive(): Promise<boolean> {
        return this.#act('makeLive', 'imagery.makeLive', (id) => ({ cityId: this.#services.cityId, versionId: id }), {
            key: 'adminContent.imagery.notice.madeLive',
        });
    }

    /** A version that never reached the map goes for good, its job, log and own files with it (`imagery.deleteVersion`). */
    deleteVersion(): Promise<boolean> {
        return this.#act('deleteVersion', 'imagery.deleteVersion', (id) => ({ cityId: this.#services.cityId, versionId: id }), {
            key: 'adminContent.imagery.notice.versionDeleted',
        });
    }

    /** M16 with M18: a recalibration of a published version leaves that one on the map, and the notice says so. */
    #rejectNotice(): AdminContentKey {
        const state = this.#state;
        return state === null ? 'adminContent.imagery.notice.rejected' : rejectNoticeOf(state);
    }

    choose(choice: PublishChoice): Promise<boolean> {
        return this.#act('choose', 'imagery.choose', (id) => ({ cityId: this.#services.cityId, versionId: id, choice }), {
            key: `adminContent.imagery.notice.chose.${choice}`,
        });
    }

    studioDone(): Promise<boolean> {
        return this.#act('studioDone', 'imagery.studioDone', (id) => ({ cityId: this.#services.cityId, versionId: id }), {
            key: 'adminContent.imagery.notice.studioLinked',
        });
    }

    retry(): Promise<boolean> {
        return this.#act('retry', 'imagery.retry', (id) => ({ cityId: this.#services.cityId, jobId: id }), {
            key: 'adminContent.imagery.notice.retrying',
        });
    }

    locateAgain(): Promise<boolean> {
        return this.#act('locate', 'imagery.locateAgain', (id) => ({ cityId: this.#services.cityId, versionId: id }), {
            key: 'adminContent.imagery.notice.locating',
        });
    }

    /** M20 §19.13: Fix the tiles, a new version of the series reopened at its tile layout; the version on the map stays. */
    fixTiles(): Promise<boolean> {
        return this.#act('fixTiles', 'imagery.relayout', (id) => ({ cityId: this.#services.cityId, versionId: id }), {
            key: 'adminContent.imagery.notice.fixingTiles',
        });
    }

    /**
     * 2026-11-23: Redraw at full resolution, the version's own points sent again (`imagery.saveGcps`): a new version warped from
     * the original, with no point moved (the georeferencer's Save waits for a change, Fix the tiles places the sheets again).
     */
    redraw(): Promise<boolean> {
        const data = this.#version.state.doc?.data;
        if (data?.georef === undefined) {
            return Promise.resolve(false);
        }
        const georef = data.georef;
        const crop = data.crop === undefined ? {} : { crop: data.crop };
        const request = (id: string) => ({
            cityId: this.#services.cityId,
            versionId: id,
            transform: georef.transform,
            gcps: georef.gcps,
            ...crop,
        });
        return this.#act('redraw', 'imagery.saveGcps', request, { key: 'adminContent.imagery.notice.redrawing' });
    }

    /** Saves the Studio file under the tileset's name, so Studio names the tileset after it (§7.5). */
    async download(): Promise<boolean> {
        const file = this.#studioFile();
        if (file === null || !this.#start('download')) {
            return false;
        }
        const saved = await this.#files.save(file.path, file.name);
        this.#finish(saved ? null : { key: 'adminContent.imagery.studio.downloadFailed' }, saved);
        return saved;
    }

    /** Asks the job to stop (`cancelRequested`); the dispatcher or the pipeline ends it. */
    async cancel(): Promise<boolean> {
        const job = this.#stoppable();
        if (job === null || !this.#start('cancel')) {
            return false;
        }
        const outcome = await this.#services.store.update(
            FIRESTORE_PATHS.job(this.#services.cityId, job.id),
            { cancelRequested: true },
            null,
        );
        this.#finish(outcome.ok ? null : { key: 'adminContent.imagery.notice.cancelRefused' });
        if (outcome.ok) {
            this.#services.notify({ key: 'adminContent.jobs.cancelRequested' });
        }
        return outcome.ok;
    }

    /** The open version's Studio file and the name it is saved under, when the export made one. */
    #studioFile(): StudioFile | null {
        const version = this.#state?.version.doc?.data ?? null;
        return version === null ? null : studioFileOf(this.#services.cityId, version);
    }

    /** The open job, when it may still be asked to stop. */
    #stoppable(): JobView | null {
        const job = this.#openJob();
        return job === null || job.finished || job.cancelRequested || job.atMapbox ? null : job;
    }

    #openJob(): JobView | null {
        return this.#state?.job.doc?.data ?? null;
    }

    async #act<N extends ImageryCallName>(
        action: VersionAction,
        name: N,
        request: (id: string) => ImageryRequest<N>,
        done: NoticeInput,
    ): Promise<boolean> {
        return (await this.#call(action, name, request, done)) !== null;
    }

    async #call<N extends ImageryCallName>(
        action: VersionAction,
        name: N,
        request: (id: string) => ImageryRequest<N>,
        done: NoticeInput,
    ): Promise<ImageryResponse<N> | null> {
        const id = this.#state?.id;
        if (id === undefined || !this.#start(action)) {
            return null;
        }
        try {
            const answer = await callImagery(this.#services.callables, name, request(id));
            this.#finish(null);
            this.#services.notify(done);
            return answer;
        } catch (error) {
            this.#finish(refusalOf(error));
            return null;
        }
    }

    /** Starts `action` unless another one runs. */
    #start(action: VersionAction): boolean {
        const state = this.#state;
        if (state?.acting !== null) {
            return false;
        }
        this.#set({ ...state, acting: action, refusal: null });
        return true;
    }

    #finish(refusal: NoticeInput | null, downloaded = false): void {
        const state = this.#state;
        if (state !== null) {
            this.#set({ ...state, acting: null, refusal, downloaded: state.downloaded || downloaded });
        }
    }

    #refresh(): void {
        const state = this.#state;
        if (state === null) {
            return;
        }
        const version = mapped(this.#version.state, versionViewOf);
        this.#followCurrent(version.doc?.data);
        const current = this.#currentView();
        this.#set({
            ...state,
            version,
            job: mapped(this.#job.state, jobViewOf),
            logs: this.#logs.list,
            usage: usageOf(this.#usage.state),
            current,
            showing: current === null ? 'new' : state.showing,
        });
    }

    /** M16: a recalibration's current version is read beside it, once its id is known. */
    #followCurrent(version: VersionView | undefined): void {
        const id = currentIdOf(version);
        if (id !== null && id !== this.#currentId) {
            this.#currentId = id;
            this.#current.show(FIRESTORE_PATHS.layerVersion(this.#services.cityId, id));
        }
    }

    #currentView(): VersionView | null {
        return this.#currentId === null ? null : (mapped(this.#current.state, versionViewOf).doc?.data ?? null);
    }

    #set(state: VersionPageState | null): void {
        this.#state = state;
        this.#changed(state);
    }
}
